/**
 * The LinkedIn API version Flas pins in the LinkedIn-Version header.
 *
 * LinkedIn retires each monthly version roughly a year after release, and a
 * retired version is refused with HTTP 426 NONEXISTENT_VERSION. 202405 was
 * pinned in the sync code until LinkedIn retired it on 2025-05-15, after which
 * every LinkedIn call failed. 202608 is listed as supported until 2027-08-17 on
 * LinkedIn's versioning page -- move this forward before then.
 *
 * One constant, because sync, discovery and the health check each hard-coded
 * their own copy and would otherwise drift apart again.
 */
export const LINKEDIN_API_VERSION = "202608";
