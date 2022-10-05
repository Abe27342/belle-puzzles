import type { AzureFunction, Context, HttpRequest } from '@azure/functions';
import { ScopeType } from '@fluidframework/azure-client';
import { generateToken } from '@fluidframework/azure-service-utils';

// injected via app setting
const key = process.env.FLUID_RELAY_KEY;

const httpTrigger: AzureFunction = async function (
	context: Context,
	req: HttpRequest
): Promise<void> {
	// tenantId, documentId, userId and userName are required parameters
	const tenantId = (req.query.tenantId ||
		(req.body && req.body.tenantId)) as string;
	const documentId = (req.query.documentId ||
		(req.body && req.body.documentId)) as string | undefined;
	const userId = (req.query.userId ||
		(req.body && req.body.userId)) as string;
	const userName = (req.query.userName ||
		(req.body && req.body.userName)) as string;
	const scopes = (req.query.scopes ||
		(req.body && req.body.scopes)) as ScopeType[];

	if (!tenantId) {
		context.res = {
			status: 400,
			body: 'No tenantId provided in query params',
		};
		return;
	}

	if (!key) {
		context.res = {
			status: 404,
			body: `No key found for the provided tenantId: ${tenantId}`,
		};
		return;
	}

	let user = { name: userName, id: userId };

	// TODO: Order of these parameters is wrong on docs.
	// Will generate the token and returned by an ITokenProvider implementation to use with the AzureClient.
	const token = generateToken(
		tenantId,
		key,
		scopes ?? [
			ScopeType.DocRead,
			ScopeType.DocWrite,
			ScopeType.SummaryWrite,
		],
		documentId,
		user
	);

	context.log(key, token);

	context.res = {
		status: 200,
		body: token,
	};
};

export default httpTrigger;
