// Only immutable domain values cross the public map boundary. The native type
// checker audits these aliases through their real Schema-derived definitions.
export type { Camera, Envelope, Marker, Presentation, Receipt, Snapshot, Theme } from "./model";
