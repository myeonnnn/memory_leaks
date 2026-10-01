import { closureContext } from './closureContext';
import { detachedDom } from './detachedDom';
import type { Scenario } from './types';
import { unboundedHistory } from './unboundedHistory';
import { videoFrames } from './videoFrames';
import { zombieListener } from './zombieListener';

export const scenarios: Scenario[] = [unboundedHistory, zombieListener, videoFrames, detachedDom, closureContext];
