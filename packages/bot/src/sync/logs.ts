export const puzzleAddedMessage = (parentName: string, name: string): string =>
	`New puzzle unlocked in round "${parentName}": "${name}".`;

export const puzzleSolvedMessage = (name: string, answer: string): string =>
	`${name} solved! Answer: "${answer}".`;

export const puzzleStatusMessage = (name: string, status?: string): string =>
	status
		? `Status updated for ${name}: "${status}".`
		: `Status cleared for ${name}.`;
