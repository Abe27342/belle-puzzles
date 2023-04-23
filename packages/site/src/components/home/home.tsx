import * as React from 'react';
import './home.css';
import { Button, Card } from '../../fast';
import { createAddBotToServerUrl } from '../../store/auth';
import belleUrl from './assets/belle.jpg';

export const Home: React.FC = () => {
	const onClick = () => {
		window.location.href = createAddBotToServerUrl();
	};
	return (
		<div className="home page-body-no-margin">
			{/* Separating the background from the content allows better opacity-based styling for smaller screens. */}
			<Card
				className="home-card home-card-background"
				style={{ height: '100%', width: '100%' }}
			/>
			<Card
				className="home-card"
				style={{
					textAlign: 'center',
					paddingTop: '30%',
					background: 'rgba(255, 255, 255, 0)',
				}}
			>
				<h1 style={{ fontSize: 96, margin: '0 0 20px' }}>
					Puzzlehunt Collab Made Easy
				</h1>
				<Button onClick={onClick} style={{ padding: '20px 15%' }}>
					<span style={{ fontSize: 32 }}>Install on Discord</span>
				</Button>
			</Card>

			<div className="belle-img">
				<LazyImage src={belleUrl} />
			</div>
		</div>
	);
};

const LazyImage: React.FC<{ src: string }> = ({ src }) => {
	const [loaded, setLoaded] = React.useState(false);
	return (
		<>
			{!loaded ? <Card /> : null}
			<img
				src={src}
				style={!loaded ? { visibility: 'hidden' } : {}}
				onLoad={() => setLoaded(true)}
			/>
		</>
	);
};
