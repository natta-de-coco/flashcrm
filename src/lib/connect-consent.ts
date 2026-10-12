/**
 * What FLAS is about to ask a provider for, in the words a business owner uses.
 *
 * Providers name their permissions for developers ("pages_manage_metadata"),
 * and their consent screen is the first thing a company sees after pressing
 * Connect. Showing the same list in plain words first means nobody is sent to
 * Facebook wondering what they are agreeing to -- and a company that is not
 * comfortable can stop before any provider is contacted.
 *
 * A scope with no entry here is left out rather than shown raw: a developer
 * string in this list would undo the point of it.
 */
const PLAIN_PERMISSIONS: Record<string, string> = {
  // Meta: Facebook Pages
  pages_show_list: "See the list of Pages you manage",
  pages_read_engagement: "Read your Page's posts and their comments",
  pages_read_user_content: "Read what other people post and comment on your Page",
  pages_manage_engagement: "Reply to comments on your Page",
  pages_messaging: "Receive your Page's Messenger conversations",
  pages_manage_metadata: "Be notified when something happens on your Page",
  read_insights: "Read your Page's statistics",
  pages_manage_posts: "Publish posts on your Page",
  // Meta: Instagram
  instagram_basic: "See the Instagram professional account linked to your Page",
  instagram_manage_comments: "Read and reply to comments on your Instagram posts",
  instagram_manage_insights: "Read your Instagram statistics",
  instagram_manage_messages: "Receive your Instagram direct messages",
  instagram_content_publish: "Publish posts to your Instagram account",
  // Meta: business and ads
  business_management: "See the business accounts you manage",
  ads_read: "Read your ad campaigns and their results",
  ads_management: "Manage your ad campaigns",
  // Google
  "https://www.googleapis.com/auth/youtube.readonly": "See your YouTube channel and its videos",
  "https://www.googleapis.com/auth/youtube.force-ssl": "Read your videos' comments",
  "https://www.googleapis.com/auth/youtube.upload": "Upload videos to your channel",
  "https://www.googleapis.com/auth/business.manage":
    "See and manage your Business Profile listings",
  "https://www.googleapis.com/auth/analytics.readonly": "Read your website statistics",
  "https://www.googleapis.com/auth/webmasters.readonly": "Read how your site performs in Search",
  "https://www.googleapis.com/auth/adwords": "Read your Google Ads campaigns",
  // LinkedIn
  r_organization_social: "Read your Company Page's posts and comments",
  rw_organization_admin: "See which Company Pages you administer",
  w_organization_social: "Publish posts on your Company Page",
  r_ads: "Read your LinkedIn ad campaigns",
  r_ads_reporting: "Read your LinkedIn ad results",
  // TikTok
  "user.info.basic": "See your TikTok profile",
  "user.info.profile": "See your TikTok profile details",
  "user.info.stats": "Read your follower and view counts",
  "video.list": "See your videos",
  "video.publish": "Publish videos to your account",
  "comment.list": "Read comments on your videos",
  "comment.create": "Reply to comments on your videos",
  // X
  "tweet.read": "Read your posts",
  "users.read": "See your profile",
  "offline.access": "Stay connected without asking you to sign in again",
  "dm.read": "Read your direct messages",
  "dm.write": "Send direct messages",
  "tweet.write": "Publish posts",
  // Pinterest
  "boards:read": "See your boards",
  "pins:read": "See your pins",
  "user_accounts:read": "See your Pinterest profile",
  // Threads
  threads_basic: "See your Threads profile and posts",
  threads_manage_insights: "Read your Threads statistics",
  threads_manage_replies: "Reply to your Threads posts",
  threads_read_replies: "Read replies to your Threads posts",
  threads_content_publish: "Publish to Threads",
};

/** The plain-word permission list for the scopes a connector asks for. */
export function plainPermissions(scopes: readonly string[] | undefined): string[] {
  const lines: string[] = [];
  for (const scope of scopes ?? []) {
    const line = PLAIN_PERMISSIONS[scope];
    if (line && !lines.includes(line)) lines.push(line);
  }
  return lines;
}

/** What the provider will ask them to choose, in that provider's own words. */
const PICKER_NOUN: Record<string, string> = {
  facebook: "Page",
  instagram: "Instagram account",
  threads: "Threads profile",
  youtube: "channel",
  google_business: "business location",
  linkedin: "Company Page",
  meta_ads: "ad account",
  google_ads: "ads account",
  google_analytics: "property",
  search_console: "site",
};

export function pickerNoun(platform: string): string {
  return PICKER_NOUN[platform] ?? "account";
}

/** Where the person goes next, said before they are sent there. */
export function handoffNote(providerName: string, pickerNoun: string): string {
  return `You'll be sent to ${providerName} to sign in and choose the ${pickerNoun}. FLAS never sees your ${providerName} password.`;
}

/**
 * The three steps a company takes for one channel, in order, written for the
 * person doing them rather than for the platform they are doing them on.
 *
 * WhatsApp is deliberately different: there is no one-click sign-in for it
 * yet, so its steps say who does the work instead of pretending otherwise.
 */
export function connectSteps(platform: string, name: string, provider?: string | null): string[] {
  if (platform === "whatsapp")
    return [
      "Have your WhatsApp Business number and the Meta business that owns it ready.",
      "A FLAS administrator connects the number for you, from Advanced admin settings.",
      "Send a message to that number and check it arrives in your inbox.",
    ];
  const signIn = provider === "meta" ? "Facebook" : provider === "google" ? "Google" : name;
  const noun = pickerNoun(platform);
  return [
    `Press Continue with ${signIn}.`,
    `Sign in with the ${signIn} account that manages your ${noun}.`,
    `Choose the ${noun} and allow access.`,
  ];
}

/** What each platform calls the ID of the account that was connected. */
const ACCOUNT_ID_LABEL: Record<string, string> = {
  facebook: "Page ID",
  instagram: "Instagram account ID",
  threads: "Threads user ID",
  youtube: "Channel ID",
  google_business: "Location ID",
  linkedin: "Organization ID",
  tiktok: "TikTok user ID",
  twitter: "X user ID",
  pinterest: "Pinterest user ID",
  meta_ads: "Ad account ID",
};

export function accountIdLabel(platform: string): string {
  return ACCOUNT_ID_LABEL[platform] ?? "Account ID";
}
