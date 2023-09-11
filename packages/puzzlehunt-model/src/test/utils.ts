import {
	ITelemetryBaseEvent,
	ITelemetryBaseLogger,
} from '@fluidframework/common-definitions';

export class TestLogger implements ITelemetryBaseLogger {
	public errorEvents: ITelemetryBaseEvent[] = [];
	public send(event: ITelemetryBaseEvent): void {
		if (event.category === 'error') {
			this.errorEvents.push(event);
		}
	}
}
