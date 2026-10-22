// Every ease dolly knows, for the camera and for the pointer.

/**
 * Camera eases map segment progress u in 0..1 onto c0 + c1 u + c2 u² + c3 u³.
 * `spline` is not listed: its cubic comes from the neighbouring keyframes.
 */
const BACK = 1.70158;
export const CAMERA_EASES = {
  smooth: [0, 0, 3, -2],
  linear: [0, 1, 0, 0],
  in: [0, 0, 0, 1],
  out: [0, 3, -3, 1],
  back: [0, 3 * (BACK + 1) - 2 * BACK, BACK - 3 * (BACK + 1), BACK + 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

export type CubicEase = keyof typeof CAMERA_EASES;
export type CameraEase = "spline" | CubicEase;
export const CAMERA_EASE_NAMES: readonly CameraEase[] = ["spline", ...(Object.keys(CAMERA_EASES) as CubicEase[])];

export function isCameraEase(name: unknown): name is CameraEase {
  return typeof name === "string" && (CAMERA_EASE_NAMES as readonly string[]).includes(name);
}

/** Pointer eases map progress 0..1 onto eased progress. `inOut` is the default travel. */
export const POINTER_EASES = {
  linear: (t: number) => t,
  inOut: (t: number) => t * t * (3 - 2 * t),
  out: (t: number) => 1 - (1 - t) ** 3,
  inQuint: (t: number) => t ** 5,
} as const satisfies Record<string, (t: number) => number>;

export type PointerEase = keyof typeof POINTER_EASES;

export function isPointerEase(name: unknown): name is PointerEase {
  return typeof name === "string" && name in POINTER_EASES;
}
