/**
 * Every competitor fact here comes from the app's Google Play listing:
 * the labels under its title ("Contains ads", "In-app purchases") and
 * its Data safety section. Nothing is from memory or reviews. Update
 * CHECKED and the rows together when a listing changes.
 */

export const CHECKED = "27 September 2026";

export interface Competitor {
	slug: string;
	name: string;
	/** Name as the Play listing shows it. */
	listing: string;
	playUrl: string;
	/** One sentence: what the app is. */
	what: string;
	/** Two short paragraphs for the comparison page. */
	intro: [string, string];
	ads: boolean;
	inAppPurchases: boolean;
	/** Data types the listing says may be shared with third parties. */
	shared: string | null;
	/** Data types the listing says may be collected. */
	collected: string | null;
	/** Where an account comes in, in plain words. */
	account: string;
	/** true, false, or a short note. */
	edits: boolean | string;
	/** Honest reasons someone would pick it over Paperwren. */
	pickIt: string;
}

export const competitors: Competitor[] = [
	{
		slug: "wps-office",
		name: "WPS Office",
		listing: "WPS Office-PDF, Word, Sheet",
		playUrl:
			"https://play.google.com/store/apps/details?id=cn.wps.moffice_eng",
		what: "A full office suite for creating and editing documents, sheets, slides and PDFs.",
		intro: [
			"WPS Office is one of the most installed office apps on Android, and it does a lot: writing, spreadsheets, slides, PDF tools and cloud storage.",
			"If all you want is to read the file someone sent you, that is a lot of app. Its Play listing is labelled with ads and in-app purchases.",
		],
		ads: true,
		inAppPurchases: true,
		shared: null,
		collected: null,
		account: "Offered for cloud storage and premium features",
		edits: true,
		pickIt: "You need to create or edit Office files on your phone.",
	},
	{
		slug: "microsoft-365",
		name: "Microsoft 365 Copilot",
		listing: "Microsoft Copilot (formerly the Microsoft 365 app)",
		playUrl:
			"https://play.google.com/store/apps/details?id=com.microsoft.office.officehubrow",
		what: "Microsoft's all-in-one app for Word, Excel, PowerPoint, OneDrive and Copilot.",
		intro: [
			"Microsoft's mobile app bundles Word, Excel, PowerPoint, PDF tools, OneDrive and the Copilot assistant, built around a Microsoft account.",
			"It is the right tool inside a Microsoft 365 workplace. As a quick viewer, it brings sign-in prompts, cloud features and, per its listing, ads and data sharing along with it.",
		],
		ads: true,
		inAppPurchases: true,
		shared: "Location and device or other IDs",
		collected: "Location, personal info and 7 other types",
		account: "Built around a Microsoft account",
		edits: true,
		pickIt:
			"You work in Microsoft 365 and edit files stored in OneDrive or SharePoint.",
	},
	{
		slug: "adobe-acrobat-reader",
		name: "Adobe Acrobat Reader",
		listing: "Adobe Acrobat Reader: Edit PDF",
		playUrl: "https://play.google.com/store/apps/details?id=com.adobe.reader",
		what: "Adobe's PDF reader, with paid tools for editing, converting and e-signing.",
		intro: [
			"Acrobat Reader is the reference PDF reader, and it adds annotation, e-signatures and a subscription tier for editing and conversion.",
			"It is a PDF app. Word, Excel and PowerPoint files are not what it is for, and its listing is labelled with ads, in-app purchases and third-party data sharing.",
		],
		ads: true,
		inAppPurchases: true,
		shared: "App activity, app info and performance, device or other IDs",
		collected: "Personal info, photos and videos and 6 other types",
		account: "Adobe account for cloud, conversion and paid tools",
		edits: true,
		pickIt: "You sign, fill or edit PDFs and already pay for Acrobat.",
	},
	{
		slug: "mobioffice",
		name: "MobiOffice",
		listing: "MobiOffice: Word, Sheets, PDF",
		playUrl:
			"https://play.google.com/store/apps/details?id=com.mobisystems.office",
		what: "An office suite (formerly OfficeSuite) with editing, PDF tools and a premium subscription.",
		intro: [
			"MobiOffice, previously OfficeSuite, is a complete editing suite with PDF tools, its own cloud drive and a premium plan.",
			"Its Play listing is labelled with ads and in-app purchases, and says it may share financial info with third parties.",
		],
		ads: true,
		inAppPurchases: true,
		shared: "Financial info",
		collected: "Personal info, financial info and 6 other types",
		account: "MobiSystems account for cloud and premium",
		edits: true,
		pickIt: "You want a paid, full editing suite on Android.",
	},
	{
		slug: "google-drive",
		name: "Google Drive",
		listing: "Google Drive",
		playUrl:
			"https://play.google.com/store/apps/details?id=com.google.android.apps.docs",
		what: "Google's cloud storage app, with a built-in file preview.",
		intro: [
			"Google Drive can preview most documents, and it is already on many phones. It has no ads, and its listing says no data is shared with third parties.",
			"But it is a cloud storage app first: it works with a Google account, and its listing says it may collect location, personal info and more.",
		],
		ads: false,
		inAppPurchases: true,
		shared: null,
		collected: "Location, personal info and 9 other types",
		account: "Google account required",
		edits: "In the separate Docs, Sheets and Slides apps",
		pickIt:
			"Your files already live in Drive and you want them on every device.",
	},
];

export const bySlug = (slug: string) =>
	competitors.find((c) => c.slug === slug);

/** Paperwren's own row, stated as plainly as the others. */
export const paperwren = {
	ads: false,
	inAppPurchases: false,
	shared: null,
	collected: null,
	account: "None. There is nothing to sign in to",
	edits: false as boolean | string,
};
