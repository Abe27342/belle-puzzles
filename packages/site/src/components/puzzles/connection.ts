import {
	AzureClient,
	AzureFunctionTokenProvider,
	AzureLocalConnectionConfig,
	AzureMember,
	AzureRemoteConnectionConfig,
} from '@fluidframework/azure-client';
import { InsecureTokenProvider } from '@fluidframework/test-client-utils';

declare const FLUID_CONNECTION_TYPE: string;

export async function getConnection(
	user?: Pick<AzureMember, 'userId' | 'userName' | 'additionalDetails'>
): Promise<AzureLocalConnectionConfig | AzureRemoteConnectionConfig> {
	// Note: This doesn't actually tree shake correctly. I confirmed that local code imported here
	// is tree shaking correctly, so it might be related to output format of test-runtime-utils.
	// This structure at least has a chance of doing so, though.
	if (FLUID_CONNECTION_TYPE === 'local') {
		const localConnection: AzureLocalConnectionConfig = {
			type: 'local',
			tokenProvider: new InsecureTokenProvider('', {
				id: 'local user id',
			}),
			endpoint: 'http://localhost:7070',
		};

		return localConnection;
	} else if (FLUID_CONNECTION_TYPE === 'remote') {
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
