import { inject } from 'vitest';
import type {} from './fluid-service.js';

process.env.FLUID_ENDPOINT = inject('fluidEndpoint');