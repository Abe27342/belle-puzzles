import express from 'express';
const app = express();
const port = 4012;

app.get('/.auth/me', (req, res) => {
	res.json({
		clientPrincipal: {
			identityProvider: 'aad',
			userId: 'Webpack John Doe',
			userDetails: 'Webpack John Doe',
			userRoles: [],
		},
	});
});
app.get('/api/discord/userId/mutualGuilds', (req, res) => {
	res.json({
		mutualGuilds: [
			{
				id: process.env.LOCAL_DISCORD_SERVER_ID,
				name: 'Test server',
			},
		],
	});
});

app.listen(port, () => {
	console.log(`Local server API listening on port ${port}`);
});
