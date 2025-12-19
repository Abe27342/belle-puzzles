import { app, HttpRequest, HttpResponse } from '@azure/functions';
import { ScopeType } from '@fluidframework/azure-client';
import { generateToken } from '@fluidframework/azure-service-utils';

// injected via app setting
const key = process.env.FLUID_RELAY_KEY;

interface TokenInfo {
	tenantId: string;
	documentId?: string;
	userId: string;
	userName?: string;
	scopes?: ScopeType[];
}

const httpTrigger = async function (req: HttpRequest): Promise<HttpResponse> {
	let reqBody: TokenInfo | undefined;
	try {
		reqBody = (await req.json()) as TokenInfo;
	} catch (err) {
		// Ignore invalid json body
	}

	const tenantId = req.query.get('tenantId') ?? reqBody?.tenantId;
	const documentId = req.query.get('documentId') ?? reqBody?.documentId;
	const userId = req.query.get('userId') ?? reqBody?.userId;
	const userName = req.query.get('userName') ?? reqBody?.userName;
	const scopes = reqBody?.scopes;

	if (!tenantId) {
		return new HttpResponse({
			status: 400,
			body: 'No tenantId provided in query params',
		});
	}

	if (!key) {
		return new HttpResponse({
			status: 404,
			body: `No key found for the provided tenantId: ${tenantId}`,
		});
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

	return new HttpResponse({
		status: 200,
		body: token,
	});
};

app.http('getToken', {
	methods: ['GET', 'POST'],
	route: 'getToken',
	authLevel: 'anonymous',
	handler: httpTrigger,
});
