export const THIRD_PARTY_COOKIE_GRANTS_KEY = "privacy.thirdPartyCookieGrants"

export interface ThirdPartyCookieGrant {
  id: string
  siteDomain: string
  embeddedDomain: string
  siteName: string
  embeddedName: string
  createdAt: number
}

export interface ThirdPartyCookieState {
  protectedByDefault: boolean
  grants: ThirdPartyCookieGrant[]
}
