/**
 * Lost and found photo thumbnail: shown from the item's photo route, and an
 * image that cannot be loaded says so with a Retry (never a blank tile).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LostFoundThumb } from "@/components/v2/admin/lost-found/lost-found-photo";

const photo = { url: "https://public.invalid/lost-found/u/a.jpg", key: "lost-found/u/a.jpg", src: "/api/lost-found/i1/photo?key=lost-found%2Fu%2Fa.jpg" };

describe("LostFoundThumb", () => {
  it("loads from the photo route, not the stored public link", () => {
    render(<LostFoundThumb photo={photo} alt="Watch" />);
    expect(screen.getByRole("img", { name: "Watch" })).toHaveAttribute("src", photo.src);
  });

  it("shows 'Image could not be loaded' with Retry, and Retry asks the route again", () => {
    const { container } = render(<LostFoundThumb photo={photo} alt="Watch" />);
    fireEvent.error(container.querySelector("img")!);
    expect(screen.getByText("Image could not be loaded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(container.querySelector("img")).toHaveAttribute("src", `${photo.src}&attempt=1`);
  });

  it("falls back to the stored link for a payload without src", () => {
    render(<LostFoundThumb photo={{ url: photo.url, key: photo.key }} alt="Watch" />);
    expect(screen.getByRole("img", { name: "Watch" })).toHaveAttribute("src", photo.url);
  });
});
