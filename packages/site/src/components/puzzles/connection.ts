import {
	AzureClient,
	AzureFunctionTokenProvider,
	AzureLocalConnectionConfig,
	AzureMember,
	AzureRemoteConnectionConfig,
} from '@fluidframework/azure-client';

export async function getConnection(
	user?: Pick<AzureMember, 'userId' | 'userName' | 'additionalDetails'>
): Promise<AzureLocalConnectionConfig | AzureRemoteConnectionConfig> {
	if (import.meta.env.VITE_FLUID_CONNECTION_TYPE === 'local') {
		const { InsecureTokenProvider } = await import(
			'@fluidframework/test-client-utils'
		);
		const localConnection: AzureLocalConnectionConfig = {
			type: 'local',
			tokenProvider: new InsecureTokenProvider('', {
				id: 'local user id',
			}),
			endpoint: 'http://localhost:7070',
		};

		return localConnection;
	} else if (import.meta.env.VITE_FLUID_CONNECTION_TYPE === 'remote') {
		return {
			type: 'remote',
			tenantId: '3ba404d1-7aff-4082-b3f8-794e6c6ae63e',
			// TODO: Docs should mention that this TokenProvider is exported from @fluidframework/azure-client.
			tokenProvider: new AzureFunctionTokenProvider(
				'/api/getToken',
				user
			),
			endpoint: 'https://us.fluidrelay.azure.com',
		};
	}

	throw new Error(
		'Attempted to create fluid connection but no type specified. This indicates a webpack issue.'
	);
}

let configuredConnection:
	| AzureRemoteConnectionConfig
	| AzureLocalConnectionConfig;

export async function createClient(
	user?: Pick<AzureMember<any>, 'userId' | 'userName' | 'additionalDetails'>
): Promise<AzureClient> {
	if (!configuredConnection) {
		configuredConnection = await getConnection(user);
	}

	return new AzureClient({
		connection: configuredConnection,
	});
}
