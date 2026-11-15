import { inject } from 'vitest';
import type {} from './fluid-service';

process.env.FLUID_ENDPOINT = inject('fluidEndpoint');