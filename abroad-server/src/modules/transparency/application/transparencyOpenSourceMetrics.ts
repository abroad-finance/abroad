import { z } from 'zod'

import type { TransparencyOpenSourceMetrics, TransparencyOpenSourceSnapshot } from './transparencyContracts'

const DAY_MS = 24 * 60 * 60 * 1000
const GITHUB_REQUEST_TIMEOUT_MS = 4_000
const REPOSITORY = 'abroad-finance/abroad'

const githubCollectionSchema = z.array(z.unknown())

const githubRepositorySchema = z.object({
  default_branch: z.string(),
  forks_count: z.number().int().nonnegative(),
  pushed_at: z.string(),
  stargazers_count: z.number().int().nonnegative(),
})

const githubSearchSchema = z.object({
  total_count: z.number().int().nonnegative(),
})

type GitHubResponse = {
  body: unknown
  headers: Headers
}

const collectionCount = (items: unknown[], headers: Headers): number => (
  lastPageFromLink(headers.get('link')) ?? items.length
)

const fetchGitHub = async (url: string): Promise<GitHubResponse> => {
  const headers = new Headers({
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'abroad-transparency-dashboard',
    'X-GitHub-Api-Version': '2022-11-28',
  })
  const token = process.env.GITHUB_TOKEN?.trim()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(GITHUB_REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`GitHub request failed with status ${response.status}`)
  }

  return {
    body: await response.json() as unknown,
    headers: response.headers,
  }
}

const lastPageFromLink = (linkHeader: null | string): null | number => {
  if (!linkHeader) return null

  for (const segment of linkHeader.split(',')) {
    if (!segment.includes('rel="last"')) continue
    const openingBracket = segment.indexOf('<')
    const closingBracket = segment.indexOf('>')
    if (openingBracket < 0 || closingBracket <= openingBracket) return null

    try {
      const url = segment.slice(openingBracket + 1, closingBracket)
      const page = Number(new URL(url).searchParams.get('page'))
      return Number.isSafeInteger(page) && page >= 0 ? page : null
    }
    catch {
      return null
    }
  }

  return null
}

export const readTransparencyOpenSourceMetrics = async (): Promise<TransparencyOpenSourceSnapshot> => {
  const since = new Date(Date.now() - 90 * DAY_MS).toISOString()
  const baseUrl = `https://api.github.com/repos/${REPOSITORY}`
  const searchUrl = 'https://api.github.com/search/issues'

  const [
    repositoryResponse,
    issuesResponse,
    pullRequestsResponse,
    contributorsResponse,
    commitsResponse,
  ] = await Promise.all([
    fetchGitHub(baseUrl),
    fetchGitHub(`${searchUrl}?q=repo:${REPOSITORY}+is:issue+is:open&per_page=1`),
    fetchGitHub(`${searchUrl}?q=repo:${REPOSITORY}+is:pr+is:open&per_page=1`),
    fetchGitHub(`${baseUrl}/contributors?anon=1&per_page=1`),
    fetchGitHub(`${baseUrl}/commits?since=${encodeURIComponent(since)}&per_page=1`),
  ])

  const repository = githubRepositorySchema.parse(repositoryResponse.body)
  const issues = githubSearchSchema.parse(issuesResponse.body)
  const pullRequests = githubSearchSchema.parse(pullRequestsResponse.body)
  const contributors = githubCollectionSchema.parse(contributorsResponse.body)
  const commits = githubCollectionSchema.parse(commitsResponse.body)

  return {
    asOf: new Date().toISOString(),
    commitsLast90Days: collectionCount(commits, commitsResponse.headers),
    contributors: collectionCount(contributors, contributorsResponse.headers),
    defaultBranch: repository.default_branch,
    forks: repository.forks_count,
    openIssues: issues.total_count,
    openPullRequests: pullRequests.total_count,
    pushedAt: repository.pushed_at,
    repository: REPOSITORY,
    stars: repository.stargazers_count,
  }
}

export const unavailableTransparencyOpenSourceMetrics = (): TransparencyOpenSourceMetrics => ({
  asOf: null,
  cache: 'unavailable',
  commitsLast90Days: null,
  contributors: null,
  defaultBranch: null,
  forks: null,
  openIssues: null,
  openPullRequests: null,
  pushedAt: null,
  repository: REPOSITORY,
  stars: null,
})
