import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

type Props = {
  /** Called once the open animation has fully played + faded out. */
  onFinish: () => void;
};

const BRAND = "#0f5a44";
const ACCENT = "#f59e0b";

/**
 * Branded open animation shown when the app launches: a ring draws in, the
 * "sNeek" wordmark rises and fades up, and an accent dot pulses, then the whole
 * thing fades out to reveal the app. Pure Animated (no image asset).
 */
export function AnimatedSplash({ onFinish }: Props) {
  const screen = useRef(new Animated.Value(1)).current; // overall opacity (fades out at end)
  const ring = useRef(new Animated.Value(0)).current; // ring scale/rotate in
  const word = useRef(new Animated.Value(0)).current; // wordmark rise/fade
  const dot = useRef(new Animated.Value(0)).current; // accent dot pulse

  useEffect(() => {
    const intro = Animated.sequence([
      Animated.parallel([
        Animated.timing(ring, { toValue: 1, duration: 600, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }),
        Animated.timing(word, { toValue: 1, duration: 600, delay: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      Animated.timing(dot, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.delay(550),
      Animated.timing(screen, { toValue: 0, duration: 380, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]);
    intro.start(({ finished }) => {
      if (finished) onFinish();
    });
    return () => intro.stop();
  }, [ring, word, dot, screen, onFinish]);

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  const ringRotate = ring.interpolate({ inputRange: [0, 1], outputRange: ["-90deg", "0deg"] });
  const wordTranslate = word.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });
  const dotScale = dot.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1.25, 1] });

  return (
    <Animated.View style={[styles.fill, { opacity: screen }]} pointerEvents="none">
      <View style={styles.center}>
        <Animated.View
          style={[styles.ring, { opacity: ring, transform: [{ scale: ringScale }, { rotate: ringRotate }] }]}
        />
        <View style={styles.row}>
          <Animated.Text style={[styles.word, { opacity: word, transform: [{ translateY: wordTranslate }] }]}>
            sNeek
          </Animated.Text>
          <Animated.View style={[styles.dot, { opacity: dot, transform: [{ scale: dotScale }] }]} />
        </View>
        <Animated.Text style={[styles.tagline, { opacity: word }]}>Property Services</Animated.Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BRAND,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  },
  center: { alignItems: "center", justifyContent: "center" },
  ring: {
    position: "absolute",
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.35)",
    borderTopColor: ACCENT,
  },
  row: { flexDirection: "row", alignItems: "flex-end" },
  word: { color: "#ffffff", fontSize: 44, fontWeight: "800", letterSpacing: 0.5 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: ACCENT, marginLeft: 4, marginBottom: 10 },
  tagline: { color: "rgba(255,255,255,0.8)", fontSize: 13, letterSpacing: 3, marginTop: 12, textTransform: "uppercase" },
});
