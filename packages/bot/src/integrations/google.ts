import '../register-env/index.js';
import { google } from 'googleapis';

let isInitialized = false;

export const createGoogleSheet = async (
	name: string,
	googleFolderId: string
) => {
	if (!isInitialized) {
		// Do this lazily to allow module load in environments that don't have access to the google api key (ex: command deployment)
		const auth = new google.auth.GoogleAuth({
			credentials: JSON.parse(process.env.GOOGLE_API_KEY),
			scopes: ['https://www.googleapis.com/auth/drive.file'],
		});
		google.options({ auth });
		isInitialized = true;
	}
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
