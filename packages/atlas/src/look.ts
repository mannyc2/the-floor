export const lineWidthCssPx = 1;
export const darkLine = { day: 0x080808, night: 0x080808 } as const;
export const lineOpacity = { day: 1, night: 1 } as const;
export const lineClasses = { ordinary: 0, surfaceDark: 1, instrumentContour: 2 } as const;
// Changing this slot order readdresses every material in the shader.
export const shading = {
  unshadedSlots: 4,
  tonesPerMaterial: 4,
  verticalThreshold: .5,
  sideTolerance: -.0001,
} as const;
