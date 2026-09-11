// Loading must be able to progress between renders, including on slow GPUs.
export function yieldToBrowser(){
  return globalThis.scheduler?.yield?globalThis.scheduler.yield():new Promise(resolve=>setTimeout(resolve,0));
}
