// Whether the main pointer is coarse (a finger): the help texts then say "tap", and the map hides its zoom buttons.
export const coarsePointer = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(pointer: coarse)').matches;
