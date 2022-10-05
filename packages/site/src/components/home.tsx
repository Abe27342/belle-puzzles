import * as React from 'react';
import './css/home.css';
import { Button, Card } from '../fast';
import { createAddBotToServerUrl } from '../store/auth';

export const Home: React.FC = () => {
	const onClick = () => {
		window.location.href = createAddBotToServerUrl();
	};
	return (
		<div className="home page-body-no-margin">
			<div>
				<Card style={{ textAlign: 'center', paddingTop: '30%' }}>
					<h1 style={{ fontSize: 96, margin: '0 0 20px' }}>
						Puzzlehunt Collab Made Easy
					</h1>
					<Button onClick={onClick} style={{ padding: '20px 15%' }}>
						<span style={{ fontSize: 32 }}>Install on Discord</span>
					</Button>
				</Card>
			</div>
			<div>
				<LazyImage src="/belle.jpg" />
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
