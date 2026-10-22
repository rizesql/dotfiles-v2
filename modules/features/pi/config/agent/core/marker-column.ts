import {
  truncateToWidth,
  visibleWidth,
  type Component,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";

export interface MarkerColumnOptions {
  continuationMarker?: string;
  footerMarker?: string;
  gap?: number;
  onGutterClick?: () => void;
}

/**
 * Reserves a stable marker column while the child owns wrapping and formatting.
 */
export class MarkerColumn implements Component {
  private marker: string;
  private continuationMarker: string;
  private footerMarker: string | undefined;
  private child: Component;
  private gap: number;
  private onGutterClick?: () => void;
  private renderedColumnWidth = 0;
  private renderedBodyHeight = 0;
  private renderedBodyOffset = 0;
  private renderedBodyWidth = 0;
  private renderedChildHeight = 0;

  constructor(marker: string, child: Component, options: MarkerColumnOptions = {}) {
    this.marker = marker;
    this.continuationMarker = options.continuationMarker ?? "";
    this.footerMarker = options.footerMarker;
    this.child = child;
    this.gap = Math.max(0, Math.floor(options.gap ?? 1));
    this.onGutterClick = options.onGutterClick;
  }

  setMarker(marker: string, continuationMarker: string = this.continuationMarker) {
    this.marker = marker;
    this.continuationMarker = continuationMarker;
  }

  setFooterMarker(footerMarker?: string) {
    this.footerMarker = footerMarker;
  }

  setChild(child: Component): void {
    this.child = child;
  }

  render(width: number) {
    const safeWidth = Math.max(0, Math.floor(width));

    if (safeWidth === 0) {
      this.renderedColumnWidth = 0;
      this.renderedBodyHeight = 0;
      this.renderedBodyOffset = 0;
      this.renderedBodyWidth = 0;
      this.renderedChildHeight = 0;
      return [];
    }

    const columnWidth = Math.min(
      safeWidth,
      Math.max(visibleWidth(this.marker), visibleWidth(this.continuationMarker)),
    );
    const gapWidth = Math.min(this.gap, Math.max(0, safeWidth - columnWidth));
    const bodyWidth = safeWidth - columnWidth - gapWidth;

    this.renderedColumnWidth = columnWidth;
    this.renderedBodyOffset = columnWidth + gapWidth;
    this.renderedBodyWidth = bodyWidth;
    this.renderedChildHeight = 0;

    const prefix = (value: string) => {
      const fitted = truncateToWidth(value, columnWidth, "");
      return `${fitted}${" ".repeat(columnWidth - visibleWidth(fitted))}${" ".repeat(gapWidth)}`;
    };

    const withFooter = (lines: string[]) => {
      this.renderedBodyHeight = lines.length;
      if (this.footerMarker) {
        lines.push(truncateToWidth(this.footerMarker, safeWidth, ""));
      }

      return lines;
    };

    if (bodyWidth <= 0) {
      return withFooter([prefix(this.marker)]);
    }

    const lines = this.child.render(bodyWidth);
    this.renderedChildHeight = lines.length;

    if (lines.length === 0) {
      return withFooter([prefix(this.marker)]);
    }

    return withFooter(
      lines.map((line, idx) =>
        truncateToWidth(
          `${prefix(idx === 0 ? this.marker : this.continuationMarker)}${line}`,
          safeWidth,
          "",
        ),
      ),
    );
  }

  handleMouse(event: TuiMouseEvent) {
    const inBodyRow = event.y >= 0 && event.y < this.renderedBodyHeight;
    const inGutter = event.x >= 0 && event.x < this.renderedColumnWidth;
    if (
      this.onGutterClick &&
      inBodyRow &&
      inGutter &&
      event.type === "click" &&
      event.button === "left" &&
      !event.shift &&
      !event.alt &&
      !event.ctrl
    ) {
      this.onGutterClick();
      return { handled: true };
    }

    const childX = event.x - this.renderedBodyOffset;
    if (
      !inBodyRow ||
      event.y >= this.renderedChildHeight ||
      childX < 0 ||
      childX >= this.renderedBodyWidth
    ) {
      return undefined;
    }

    return this.child.handleMouse?.({
      ...event,
      x: childX,
      width: this.renderedBodyWidth,
      height: this.renderedChildHeight,
    });
  }

  invalidate() {
    this.child.invalidate();
  }
}
