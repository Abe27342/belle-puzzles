import {
	AzureClient,
	AzureLocalConnectionConfig,
	AzureRemoteConnectionConfig,
	AzureUser,
	IUser,
} from '@fluidframework/azure-client';
import { InsecureTokenProvider } from '@fluidframework/test-client-utils';
import { ScopeType } from '@fluidframework/protocol-definitions';
import '../register-env/index.js';

const useLocalService = !!process.env.USE_LOCAL_SERVICE;

const user: IUser & AzureUser = {
	id: 'belle-bot',
	name: 'belle-bot',
};

const localConnection: AzureLocalConnectionConfig = {
	type: 'local',
	tokenProvider: new InsecureTokenProvider('', user),
	endpoint: 'http://localhost:7070',
};

const remoteConnection: AzureRemoteConnectionConfig = {
	tenantId: process.env.FLUID_TENANT_ID,
	tokenProvider: new InsecureTokenProvider(
		process.env.FLUID_PRIMARY_KEY,
		user
	),
	endpoint: 'https://us.fluidrelay.azure.com',
	type: 'remote',
};

// Using the same AzureClient for multiple documents encounters the bug fixed in this PR
// and causes document corruption:
// https://github.com/microsoft/FluidFramework/pull/12060
// Once that fix is in, this could be simplified to just an exported client.
export const makeFluidClient = (options: { readOnly?: boolean } = {}) => {
	return new AzureClient({
		connection: options.readOnly
			? makeReadOnlyFluidConnection()
			: useLocalService
			? localConnection
			: remoteConnection,
		logger: {
			send: (event) => {
				if (event.category === 'error') {
					try {
						console.error(JSON.stringify(event));
					} catch (err) {}
				}
			},
		},
	});
};

export function makeReadOnlyFluidConnection() {
	const connection = useLocalService ? localConnection : remoteConnection;
	const exportUser: IUser & AzureUser = {
		id: 'belle-exporter',
		name: 'belle-exporter',
	};
	return {
		...connection,
		tokenProvider: new InsecureTokenProvider(
			useLocalService ? '' : process.env.FLUID_PRIMARY_KEY,
			exportUser,
			[ScopeType.DocRead]
		),
	};
}
