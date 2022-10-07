import '../register-env/index.js';
import { google } from 'googleapis';

const auth = new google.auth.GoogleAuth({
	credentials: JSON.parse(process.env.GOOGLE_API_KEY),
	scopes: ['https://www.googleapis.com/auth/drive.file'],
});
google.options({ auth });

export const createGoogleSheet = async (
	name: string,
	googleFolderId: string
) => {
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
