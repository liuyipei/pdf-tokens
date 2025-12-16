declare module 'canvas' {
  export interface CanvasRenderingContext2D {}
  export interface Canvas {
    getContext(contextId: '2d'): CanvasRenderingContext2D;
    toDataURL(): string;
  }

  export function createCanvas(width: number, height: number): Canvas;
}
