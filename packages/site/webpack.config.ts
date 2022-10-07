import * as path from 'path';
import * as webpack from 'webpack';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import 'webpack-dev-server';
import * as dotenv from 'dotenv';
import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';

dotenv.config({ path: `${__dirname}/../../.env` });

interface StringMap<T> {
	[key: string]: T;
}

const makeConfig = (
	env: StringMap<string>,
	argv: StringMap<string>
): webpack.Configuration => {
	const useLocalService = env.FLUID_CONNECTION === 'local';
	if (useLocalService) {
		console.log(
			'Running a build for use with local fluid connections (i.e. local routerlicious)'
		);
	} else {
		console.log(
			'Running a build for remote fluid connections (i.e. Azure Fluid Relay)'
		);
	}

	return {
		entry: './src/index.tsx',
		mode: argv.mode === 'production' ? 'production' : 'development',
		devtool: argv.mode === 'production' ? undefined : 'inline-source-map',
		devServer: {
			https: true,
			static: {
				directory: path.join(__dirname, 'static'),
			},
			port: 9000,
			// Enables fallback of non-root routes, see here:
			// https://stackoverflow.com/questions/31945763/how-to-tell-webpack-dev-server-to-serve-index-html-for-any-route
			historyApiFallback: {
				index: 'index.html',
			},
			onBeforeSetupMiddleware: (server) => {
				// Mock the /.auth/me route
				server.app?.get('/.auth/me', (req, res) => {
					res.json({
						clientPrincipal: {
							identityProvider: 'aad',
							userId: 'Webpack John Doe',
							userDetails: 'Webpack John Doe',
							userRoles: [],
						},
					});
				});
				server.app?.get(
					'/api/discord/userId/mutualGuilds',
					(req, res) => {
						res.json({
							mutualGuilds: [
								{
									id: process.env.LOCAL_DISCORD_SERVER_ID,
									name: 'Test server',
								},
							],
						});
					}
				);
			},
		},
		module: {
			rules: [
				{
					test: /\.css$/i,
					// TODO: This inlines styles which isn't great for prod builds. See recommendations here:
					// https://github.com/webpack-contrib/css-loader#recommend
					use: ['style-loader', 'css-loader'],
					exclude: /node_modules/,
				},
				{
					test: /\.tsx?$/,
					use: [
						{
							loader: 'ts-loader',
							options: { transpileOnly: true },
						},
					],
					exclude: /node_modules/,
				},
			],
		},
		resolve: {
			extensions: ['.js', '.tsx', '.ts', '.css'],
			fallback: {
				assert: require.resolve('assert'),
			},
		},
		output: {
			filename: 'app.js',
			path: path.resolve(__dirname, 'static'),
		},
		plugins: [
			// fix 'process is not defined' error for util checking NODE_DEBUG.
			// May not be necessary after using a real fluid token provider.
			new webpack.ProvidePlugin({
				process: 'process/browser',
			}),
			new webpack.DefinePlugin({
				FLUID_CONNECTION_TYPE: JSON.stringify(
					useLocalService ? 'local' : 'remote'
				),
				BELLE_BOT_BASE_URL: JSON.stringify(
					useLocalService
						? 'http://localhost:3000'
						: 'https://belle-puzzles.herokuapp.com'
				),
			}),
			new ForkTsCheckerWebpackPlugin(),
			new BundleAnalyzerPlugin({
				analyzerMode: 'static',
				openAnalyzer: false,
			}),
		],
	};
};

export default makeConfig;
