import * as React from 'react';
import { Card, Button, Dialog, TextField } from '../../../fast';

export type InputResult =
	| { type: 'success' }
	// displayMessage will be propagated to the user.
	| { type: 'error'; displayMessage: string };

export interface SingleInputModalProps {
	title: string;
	description: string;
	placeholderText: string;
	confirmText: string;
	close: () => void;
	processInput(input: string): InputResult;
}

export const SingleInputModal: React.FC<SingleInputModalProps> = ({
	title,
	description,
	placeholderText,
	confirmText,
	processInput,
	close,
}) => {
	const [errorText, setErrorText] = React.useState<string | undefined>(
		undefined
	);
	const [content, setContent] = React.useState<string | undefined>(undefined);

	React.useEffect(() => {
		if (errorText) {
			setTimeout(() => setErrorText(undefined), 5000);
		}
	}, [errorText]);
	const errorStyles = {
		border: '2px solid red',
		borderRadius: '5px',
	};

	return (
		<Dialog
			modal
			className="modal"
			style={
				{
					'--dialog-width': '480px',
					'--dialog-height': '320px',
				} as any /* these are custom properties on fast components */
			}
		>
			<Card
				style={{ overflow: 'auto' }}
				/* prevent light-dismiss */
				onClick={(event) => event.stopPropagation()}
			>
				<h1>{title}</h1>
				<p>{description}</p>
				<TextField
					required={true}
					style={{
						...(!content && errorText ? errorStyles : {}),
					}}
					onChange={(event) => {
						const content = (event.target as any).value;
						setContent(content);
					}}
					placeholder={placeholderText}
					{...(content ? { value: content } : {})}
				/>
				{errorText && (
					<p
						style={{
							position: 'fixed',
							bottom: 'calc(var(--card-padding) + 25px)',
							right: 'var(--card-padding)',
						}}
					>
						{errorText}
					</p>
				)}
				<Button
					appearance={'neutral'}
					style={{
						position: 'fixed',
						bottom: 'var(--card-padding)',
						left: 'var(--card-padding)',
					}}
					onClick={close}
				>
					Cancel
				</Button>
				<Button
					appearance={'accent'}
					style={{
						position: 'fixed',
						bottom: 'var(--card-padding)',
						right: 'var(--card-padding)',
					}}
					onClick={() => {
						const result = processInput(content);
						if (result.type === 'error') {
							setErrorText(result.displayMessage);
						} else {
							close();
						}
					}}
				>
					{confirmText}
				</Button>
			</Card>
		</Dialog>
	);
};
