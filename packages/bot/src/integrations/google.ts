import '../register-env/index.js';
import { google, type sheets_v4 } from 'googleapis';

export const createGoogleSheet = async (
	name: string,
	googleFolderId: string
) => {
	const auth = new google.auth.GoogleAuth({
		credentials: JSON.parse(process.env.GOOGLE_API_KEY),
		scopes: ['https://www.googleapis.com/auth/drive.file'],
	});
	google.options({ auth });
	const drive = google.drive({ version: 'v3' });
	const file = await drive.files.copy({
		fileId: GOOGLE_SHEET_TEMPLATE_ID,
		requestBody: {
			name,
			parents: [googleFolderId],
			mimeType: 'application/vnd.google-apps.spreadsheet',
		},
	});
	return file.data.id;
};

// TODO: We could consider making the template sheet customizable on hunt creation.
// Since Belle Bot only gets drive.file though, the flow might be somewhat janky.
export const GOOGLE_SHEET_TEMPLATE_ID =
	'1IqR4EcKA7gkxvveIzPCgcbcWUozMbsQwDXbKcQaPH9U';

export async function updateSheetValues(
	params: sheets_v4.Params$Resource$Spreadsheets$Values$Batchupdate
): Promise<void> {
	const auth = new google.auth.GoogleAuth({
		credentials: JSON.parse(process.env.GOOGLE_API_KEY),
		scopes: ['https://www.googleapis.com/auth/drive.file'],
	});
	google.options({ auth });
	const sheets = google.sheets({ version: 'v4' });
	const response = await sheets.spreadsheets.values.batchUpdate(params);

	if (response.status !== 200) {
		console.log(response);
		throw new Error(`Issue updating data: ${response.statusText}`);
	}
}

export async function updateSheet(
	params: sheets_v4.Params$Resource$Spreadsheets$Batchupdate
): Promise<sheets_v4.Schema$BatchUpdateSpreadsheetResponse> {
	const auth = new google.auth.GoogleAuth({
		credentials: JSON.parse(process.env.GOOGLE_API_KEY),
		scopes: ['https://www.googleapis.com/auth/drive.file'],
	});
	google.options({ auth });
	const sheets = google.sheets({ version: 'v4' });
	const response = await sheets.spreadsheets.batchUpdate(params);

	if (response.status !== 200) {
		console.log(response);
		throw new Error(`Issue updating data: ${response.statusText}`);
	}

	return response.data;
}

export async function getByDataFilter(
	params: sheets_v4.Params$Resource$Spreadsheets$Getbydatafilter
): Promise<sheets_v4.Schema$Spreadsheet> {
	const auth = new google.auth.GoogleAuth({
		credentials: JSON.parse(process.env.GOOGLE_API_KEY),
		scopes: ['https://www.googleapis.com/auth/drive.file'],
	});
	google.options({ auth });
	const sheets = google.sheets({ version: 'v4' });
	const response = await sheets.spreadsheets.getByDataFilter(params);

	if (response.status !== 200) {
		console.log(response);
		throw new Error(`Issue updating data: ${response.statusText}`);
	}

	return response.data;
}
