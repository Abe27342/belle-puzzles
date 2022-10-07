// TODO: Latest tag on this is wrong. Report it.
// TODO: Docs link on sample code has two different links. One is out of date.
import {
	AzureClient,
	AzureConnectionConfig,
	AzureRemoteConnectionConfig,
} from '@fluidframework/azure-client';
import { InsecureTokenProvider } from '@fluidframework/test-client-utils';
import '../register-env/index.js';

const useLocalService = !!process.env.USE_LOCAL_SERVICE;

const localConnection: AzureConnectionConfig = {
	type: 'local',
	tokenProvider: new InsecureTokenProvider('', { id: 'userId ' }),
	endpoint: 'http://localhost:7070',
};

const remoteConnection: AzureRemoteConnectionConfig = {
	tenantId: process.env.FLUID_TENANT_ID,
	tokenProvider: new InsecureTokenProvider(process.env.FLUID_PRIMARY_KEY, {
		id: 'belle-bot',
	}),
	endpoint: 'https://us.fluidrelay.azure.com',
	type: 'remote',
};

// Using the same AzureClient for multiple documents encounters the bug fixed in this PR
// and causes document corruption:
// https://github.com/microsoft/FluidFramework/pull/12060
// Once that fix is in, this could be simplified to just an expored client.
export const makeFluidClient = () => {
	return new AzureClient({
		connection: useLocalService ? localConnection : remoteConnection,
	});
};
