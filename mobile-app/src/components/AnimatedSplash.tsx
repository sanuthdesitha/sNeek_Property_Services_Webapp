import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet } from "react-native";

type Props = {
  /** Called once the open animation has fully played + zoomed out of view. */
  onFinish: () => void;
};

/**
 * Branded open animation using the sNeek logo on a white field:
 *  1. The logo fades in and zooms up from small.
 *  2. It "breathes" — a gentle fade in/out while slowly zooming in — as the app
 *     loads behind it.
 *  3. A quick zoom-in blows the logo up to cover the whole screen while fading
 *     out, then it disappears to reveal the app.
 */
export function AnimatedSplash({ onFinish }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    const sequence = Animated.sequence([
      // 1. Fade in + zoom up to resting size.
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 600,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.back(1.4)),
          useNativeDriver: true,
        }),
      ]),
      // 2. Breathe: fade in/out twice while creeping the zoom in.
      Animated.parallel([
        Animated.sequence([
          Animated.timing(opacity, {
            toValue: 0.55,
            duration: 480,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 480,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.65,
            duration: 420,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 1,
            duration: 420,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(scale, {
          toValue: 1.25,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
      // 3. Quick zoom to cover the whole screen, fading out as it goes.
      Animated.parallel([
        Animated.timing(scale, {
          toValue: 16,
          duration: 420,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 380,
          delay: 60,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]);

    sequence.start(({ finished }) => {
      if (finished) onFinish();
    });
    return () => sequence.stop();
  }, [opacity, scale, onFinish]);

  return (
    <Animated.View style={styles.fill} pointerEvents="none">
      <Animated.Image
        source={require("../../assets/icon.png")}
        resizeMode="contain"
        style={[styles.logo, { opacity, transform: [{ scale }] }]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  },
  logo: {
    width: 240,
    height: 240,
  },
});
