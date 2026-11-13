/**
 * One google.maps.OverlayView that hosts the Live ops pins as DOM. The map
 * component renders React into `container` (a portal); `draw` runs when the
 * projection changes (zoom, resize, a large move), which is when pixel
 * positions must be recomputed. No mapId or AdvancedMarker needed, so it works
 * with the shared loader as configured today.
 */

// Google Maps has no types installed in this project; the handles stay opaque.
/* eslint-disable @typescript-eslint/no-explicit-any */
type MapsHandle = any;

export type PinOverlay = {
  container: HTMLDivElement;
  /** Pixel position inside the overlay pane; null before the first draw. */
  toPixel: (lat: number, lng: number) => { x: number; y: number } | null;
  remove: () => void;
};

export function createPinOverlay(g: MapsHandle, map: MapsHandle, onDraw: () => void): PinOverlay {
  const container = document.createElement("div");
  container.className = "font-sans";
  container.style.position = "absolute";
  container.style.left = "0";
  container.style.top = "0";
  container.dataset.opsPins = "true";

  const Base = g.maps.OverlayView as { new (): MapsHandle; preventMapHitsAndGesturesFrom?: (element: HTMLElement) => void };
  class PinLayer extends Base {
    onAdd() {
      this.getPanes().overlayMouseTarget.appendChild(container);
      // Clicks, taps and drags on a pin are the pin's, not the map's.
      Base.preventMapHitsAndGesturesFrom?.(container);
    }
    draw() {
      onDraw();
    }
    onRemove() {
      container.remove();
    }
  }

  const layer: MapsHandle = new PinLayer();
  layer.setMap(map);
  return {
    container,
    toPixel: (lat, lng) => {
      const projection = layer.getProjection?.();
      if (!projection) return null;
      const point = projection.fromLatLngToDivPixel(new g.maps.LatLng(lat, lng));
      return point ? { x: point.x, y: point.y } : null;
    },
    remove: () => layer.setMap(null),
  };
}
