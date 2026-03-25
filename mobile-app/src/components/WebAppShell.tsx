import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent, type ShouldStartLoadRequest } from "react-native-webview";
import { buildWebUrl, isInternalWebUrl, MOBILE_CONFIG } from "@/config";
import type { PushState } from "@/hooks/usePushNotifications";

type Props = {
  notifications: PushState;
};

type NativeBridgeMessage =
  | { type: "OPEN_EXTERNAL_URL"; url: string }
  | { type: "OPEN_PATH"; path: string }
  | { type: "REQUEST_PUSH_CONTEXT" }
  | { type: "RELOAD_APP" };

function serializeForInjectedJs(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function buildContextPayload(notifications: PushState) {
  return {
    platform: Platform.OS,
    appVersion: MOBILE_CONFIG.appVersion,
    webAppUrl: MOBILE_CONFIG.webAppUrl,
    expoPushToken: notifications.expoPushToken,
    notificationPermission: notifications.permissionStatus,
    notificationError: notifications.notificationError
  };
}

function buildContextInjection(payload: ReturnType<typeof buildContextPayload>) {
  const serialized = serializeForInjectedJs(payload);
  return `
    (function() {
      var payload = ${serialized};
      window.__SNEEK_NATIVE_CONTEXT__ = payload;
      try {
        window.localStorage.setItem("sneek-native-context", JSON.stringify(payload));
      } catch (e) {}
      if (typeof window.CustomEvent === "function") {
        window.dispatchEvent(new CustomEvent("sneek-native-context", { detail: payload }));
      }
    })();
    true;
  `;
}

export function WebAppShell({ notifications }: Props) {
  const webViewRef = useRef<WebView>(null);
  const [currentUrl, setCurrentUrl] = useState(buildWebUrl());
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const nativeContext = useMemo(() => buildContextPayload(notifications), [notifications]);
  const injectedContext = useMemo(
    () => buildContextInjection(nativeContext),
    [nativeContext]
  );

  function navigateInWebView(nextUrl: string) {
    const absolute = buildWebUrl(nextUrl);
    setCurrentUrl(absolute);
    webViewRef.current?.injectJavaScript(`
      window.location.href = ${serializeForInjectedJs(absolute)};
      true;
    `);
  }

  useEffect(() => {
    webViewRef.current?.injectJavaScript(injectedContext);
  }, [injectedContext]);

  useEffect(() => {
    if (!notifications.lastNotificationPath) return;
    navigateInWebView(notifications.lastNotificationPath);
  }, [notifications.lastNotificationPath]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBack) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [canGoBack]);

  async function openExternalUrl(url: string) {
    try {
      await Linking.openURL(url);
    } catch {}
  }

  function handleMessage(event: WebViewMessageEvent) {
    try {
      const data = JSON.parse(event.nativeEvent.data) as NativeBridgeMessage;
      if (data.type === "OPEN_EXTERNAL_URL" && data.url) {
        void openExternalUrl(data.url);
      } else if (data.type === "OPEN_PATH" && data.path) {
        navigateInWebView(data.path);
      } else if (data.type === "REQUEST_PUSH_CONTEXT") {
        webViewRef.current?.injectJavaScript(injectedContext);
      } else if (data.type === "RELOAD_APP") {
        setCurrentUrl(buildWebUrl());
        setPageError(null);
      }
    } catch {
      // Ignore non-JSON messages from the web app.
    }
  }

  function handleShouldStartLoad(request: ShouldStartLoadRequest) {
    if (request.navigationType === "click" && !isInternalWebUrl(request.url)) {
      void openExternalUrl(request.url);
      return false;
    }
    return true;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>sNeek Mobile</Text>
            <Text style={styles.subtitle}>Live web app shell for Android and iOS</Text>
          </View>
          <Pressable style={styles.headerButton} onPress={() => webViewRef.current?.reload()}>
            <Text style={styles.headerButtonText}>Reload</Text>
          </Pressable>
        </View>

        {pageError ? (
          <View style={styles.errorWrap}>
            <Text style={styles.errorTitle}>The app could not load the hosted site.</Text>
            <Text style={styles.errorText}>{pageError}</Text>
            <View style={styles.errorActions}>
              <Pressable style={styles.primaryButton} onPress={() => {
                setPageError(null);
                setLoading(true);
                setCurrentUrl(buildWebUrl());
              }}>
                <Text style={styles.primaryButtonText}>Retry</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => void openExternalUrl(currentUrl)}>
                <Text style={styles.secondaryButtonText}>Open in browser</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.webWrap}>
            <WebView
              ref={webViewRef}
              source={{ uri: currentUrl }}
              style={styles.webView}
              originWhitelist={["*"]}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              javaScriptEnabled
              domStorageEnabled
              pullToRefreshEnabled
              setSupportMultipleWindows={false}
              allowsBackForwardNavigationGestures
              userAgent={`sNeekMobile/${MOBILE_CONFIG.appVersion}`}
              injectedJavaScriptBeforeContentLoaded={injectedContext}
              onLoadStart={() => {
                setLoading(true);
                setPageError(null);
              }}
              onLoadEnd={() => setLoading(false)}
              onNavigationStateChange={(state) => {
                setCurrentUrl(state.url);
                setCanGoBack(state.canGoBack);
              }}
              onShouldStartLoadWithRequest={handleShouldStartLoad}
              onMessage={handleMessage}
              onError={(event) => {
                setLoading(false);
                setPageError(event.nativeEvent.description || "Unknown web view error.");
              }}
            />
            {loading ? (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color="#0f5a44" />
                <Text style={styles.loadingText}>Loading the live operations dashboard...</Text>
              </View>
            ) : null}
          </View>
        )}

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Push:{" "}
            {notifications.expoPushToken
              ? "registered"
              : notifications.notificationError
                ? notifications.notificationError
                : notifications.permissionStatus}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f7faf8"
  },
  root: {
    flex: 1,
    backgroundColor: "#f7faf8"
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#d7e3dd",
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#17352d"
  },
  subtitle: {
    fontSize: 12,
    color: "#5c6f67",
    marginTop: 2
  },
  headerButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#0f5a44"
  },
  headerButtonText: {
    color: "#ffffff",
    fontWeight: "600"
  },
  webWrap: {
    flex: 1
  },
  webView: {
    flex: 1
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(247,250,248,0.9)",
    gap: 12
  },
  loadingText: {
    color: "#355349",
    fontSize: 14
  },
  errorWrap: {
    flex: 1,
    padding: 24,
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 10
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#17352d"
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#5a5a5a"
  },
  errorActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 6
  },
  primaryButton: {
    backgroundColor: "#0f5a44",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "600"
  },
  secondaryButton: {
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#c9d8d1",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10
  },
  secondaryButtonText: {
    color: "#17352d",
    fontWeight: "600"
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: "#d7e3dd",
    backgroundColor: "#ffffff",
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  footerText: {
    fontSize: 12,
    color: "#5c6f67"
  }
});
