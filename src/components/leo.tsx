import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SVGProps
} from "react"

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ")
}

export type LeoIconName =
  | "browser-extensions"
  | "chevrons-down"
  | "chevrons-up"
  | "check-normal"
  | "close"
  | "cookie"
  | "eye-on"
  | "file-export"
  | "globe"
  | "history"
  | "inbox"
  | "link-normal"
  | "paint-brush"
  | "pin"
  | "picture-in-picture"
  | "puzzle-piece"
  | "product-bookmarks"
  | "radio-checked"
  | "rss"
  | "screenshot"
  | "search"
  | "settings"
  | "shield"
  | "star-outline"
  | "terminal"
  | "trash"
  | "warning-triangle-outline"

const puzzlePieceIcon = (
  <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M14.338 19.333H18c.46 0 .833-.373.833-.833v-2.134c0-.46.373-.834.834-.834a1.667 1.667 0 0 0 0-3.333.833.833 0 0 1-.834-.833V6A.833.833 0 0 0 18 5.167h-3.333a.833.833 0 0 1-.834-.834 1.667 1.667 0 1 0-3.333 0c0 .46-.373.834-.833.834H5.5A.833.833 0 0 0 4.667 6v2.605a3.335 3.335 0 0 1 0 6.457V18.5c0 .46.373.833.833.833h2.305a3.334 3.334 0 0 1 6.533 0M20.5 18.5A2.5 2.5 0 0 1 18 21h-4.434a.833.833 0 0 1-.832-.888l.004-.112a1.667 1.667 0 1 0-3.33.112.833.833 0 0 1-.831.888H5.5A2.5 2.5 0 0 1 3 18.5v-4.167c0-.46.373-.833.833-.833a1.667 1.667 0 0 0 0-3.333A.833.833 0 0 1 3 9.333V6a2.5 2.5 0 0 1 2.5-2.5h3.438a3.335 3.335 0 0 1 6.457 0H18A2.5 2.5 0 0 1 20.5 6v4.637a3.335 3.335 0 0 1 0 6.457z" />
)

const ICONS: Record<LeoIconName, ReactNode> = {
  "browser-extensions": puzzlePieceIcon,
  "chevrons-down": (
    <path fill="currentColor" d="M5.47 6.72a.75.75 0 0 1 1.06 0L12 12.19l5.47-5.47a.75.75 0 1 1 1.06 1.06l-6 6a.75.75 0 0 1-1.06 0l-6-6a.75.75 0 0 1 0-1.06m0 5a.75.75 0 0 1 1.06 0L12 17.19l5.47-5.47a.75.75 0 1 1 1.06 1.06l-6 6a.75.75 0 0 1-1.06 0l-6-6a.75.75 0 0 1 0-1.06" />
  ),
  "chevrons-up": (
    <path fill="currentColor" d="M11.47 5.22a.75.75 0 0 1 1.06 0l6 6a.75.75 0 1 1-1.06 1.06L12 6.81l-5.47 5.47a.75.75 0 0 1-1.06-1.06zm0 5a.75.75 0 0 1 1.06 0l6 6a.75.75 0 1 1-1.06 1.06L12 11.81l-5.47 5.47a.75.75 0 0 1-1.06-1.06z" />
  ),
  "check-normal": (
    <path fill="currentColor" d="M19.528 5.333a1.2 1.2 0 0 0-1.678.227L9.973 15.9l-3.93-3.93a1.197 1.197 0 0 0-1.692 1.694l4.897 4.898a1.197 1.197 0 0 0 1.8-.121L19.754 7.01c.4-.526.3-1.277-.227-1.678" />
  ),
  close: (
    <path fill="currentColor" d="M5.287 5.287a.85.85 0 0 0 0 1.202L10.797 12l-5.51 5.511a.85.85 0 0 0 1.202 1.202L12 13.203l5.51 5.51a.85.85 0 0 0 1.202-1.203L13.202 12l5.51-5.51a.85.85 0 0 0-1.202-1.202L12 10.798 6.489 5.287a.85.85 0 0 0-1.202 0" />
  ),
  cookie: (
    <>
      <path fill="currentColor" d="M10.47 9.77a1.326 1.326 0 1 0 0-2.65 1.326 1.326 0 0 0 0 2.65m-2.042 5.096a1.326 1.326 0 1 0 .002-2.651 1.326 1.326 0 0 0-.002 2.651M15 16.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3" />
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M19.08 6.991a3.05 3.05 0 0 0 .467 2.82c.581.778 1.498 1.293 2.418 1.367C22.448 17.026 17.831 22 12 22c-5.52 0-10-4.474-10-9.987C2 6.475 7.022.873 13.887 2.196c-.45 2.958 2.232 5.5 5.194 4.795m-6.825-3.35.028.165c.414 2.503 2.407 4.492 4.92 4.866l.143.022.027.141a4.95 4.95 0 0 0 2.863 3.552l.13.059-.01.141c-.303 4.504-4.111 7.782-8.356 7.782-4.613 0-8.367-3.75-8.367-8.356 0-1.736.714-3.866 2.123-5.544 1.413-1.683 3.531-2.917 6.332-2.833z" />
    </>
  ),
  "eye-on": (
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M12 19.5c-6.496 0-10-5.323-10-7.5s3.504-7.5 10-7.5S22 9.823 22 12s-3.504 7.5-10 7.5m0-13.333c-5.653 0-8.333 4.679-8.333 5.833s2.68 5.833 8.333 5.833 8.333-4.679 8.333-5.833S17.653 6.167 12 6.167m0 10A4.17 4.17 0 0 1 7.833 12 4.17 4.17 0 0 1 12 7.833 4.17 4.17 0 0 1 16.167 12 4.17 4.17 0 0 1 12 16.167M12 9.5A2.503 2.503 0 0 0 9.5 12c0 1.378 1.122 2.5 2.5 2.5s2.5-1.122 2.5-2.5-1.122-2.5-2.5-2.5" />
  ),
  "file-export": (
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M16.167 15.336q-.001.168-.066.32c-.004.012-.014.02-.02.03a.8.8 0 0 1-.158.238l-2.5 2.499a.83.83 0 0 1-.59.243.833.833 0 0 1-.59-1.422l1.079-1.077H8.667a.834.834 0 0 1 0-1.667h4.654l-1.077-1.078a.833.833 0 1 1 1.179-1.178l2.496 2.497q.118.117.184.274c.025.06.029.13.039.195.006.042.025.08.025.123zM5.957 3.515a.31.31 0 0 0-.308.309v16.35c0 .17.138.308.308.308h12.086c.17 0 .308-.137.308-.308v-8.53a2.44 2.44 0 0 0-2.44-2.441h-1.423a1.825 1.825 0 0 1-1.824-1.825V5.957a2.44 2.44 0 0 0-2.441-2.44zm0-1.516a1.825 1.825 0 0 0-1.824 1.825v16.35c0 1.008.817 1.825 1.824 1.825h12.086a1.825 1.825 0 0 0 1.824-1.825V11.29A9.29 9.29 0 0 0 10.578 2zm7.813 2.2c.262.53.41 1.126.41 1.757V7.38c0 .17.138.308.308.308h1.422c.631 0 1.228.148 1.758.41A7.8 7.8 0 0 0 13.77 4.2" />
  ),
  globe: (
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2M3.67 12c0-4.6 3.73-8.33 8.33-8.33S20.33 7.4 20.33 12 16.6 20.33 12 20.33 3.67 16.6 3.67 12m1.13-.8a.8.8 0 0 0 0 1.6h14.4a.8.8 0 1 0 0-1.6zM12 4.5c-.28 0-.54.15-.68.39A14.1 14.1 0 0 0 9.25 12c0 2.56.72 5.03 2.07 7.11a.8.8 0 0 0 1.36 0A14.1 14.1 0 0 0 14.75 12c0-2.56-.72-5.03-2.07-7.11A.8.8 0 0 0 12 4.5m0 2.47c.75 1.55 1.15 3.27 1.15 5.03S12.75 15.48 12 17.03A12.4 12.4 0 0 1 10.85 12c0-1.76.4-3.48 1.15-5.03" />
  ),
  history: (
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M2.77 11.23A.77.77 0 0 0 2 12c0 5.523 4.477 10 10 10s10-4.477 10-10S17.523 2 12 2a9.97 9.97 0 0 0-6.304 2.236 2.608 2.608 0 1 0 1.16 1.045A8.461 8.461 0 1 1 3.539 12a.77.77 0 0 0-.77-.77m14.615.77h-4.052a1.55 1.55 0 0 0-.564-.563V8.154a.77.77 0 1 0-1.538 0v3.283a1.538 1.538 0 1 0 2.102 2.102h4.052a.77.77 0 0 0 0-1.539" />
  ),
  inbox: (
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M21 18c0 .827-.673 1.5-1.5 1.5h-15c-.827 0-1.5-.673-1.5-1.5v-6c0-.069.022-.132.04-.196a.74.74 0 0 1-.02-.376l1.5-6.35a.75.75 0 0 1 .73-.577h3a.75.75 0 0 1 0 1.5H5.843l-1.24 5.25H9a.75.75 0 0 1 .75.75 2.25 2.25 0 0 0 2.249 2.25 2.253 2.253 0 0 0 2.251-2.25.75.75 0 0 1 .75-.75h4.397l-1.24-5.25H15a.75.75 0 0 1 0-1.5h3.749a.75.75 0 0 1 .73.577l1.5 6.35c.03.13.015.256-.02.376.018.064.04.127.04.197zm-1.403-5.25h-3.922a3.76 3.76 0 0 1-3.677 3.002 3.754 3.754 0 0 1-3.672-3.001H4.5V18h15.097zM14.47 7.72a.749.749 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06l1.754 1.753V3.75c0-.414.302-.75.716-.75a.75.75 0 0 1 .75.75v5.69z" />
  ),
  "link-normal": (
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M13.434 4.434a4.336 4.336 0 0 1 6.132 6.132l-3.998 3.997a4.3 4.3 0 0 1-6.14-.003.8.8 0 0 1 1.143-1.12 2.7 2.7 0 0 0 3.858 0l.005-.006 4-4a2.736 2.736 0 0 0-3.868-3.868l-.5.5a.8.8 0 0 1-1.132-1.132zm-3.6 4.051a4.3 4.3 0 0 1 4.737.955.8.8 0 1 1-1.142 1.12 2.7 2.7 0 0 0-3.858 0l-.005.006-4 4a2.735 2.735 0 1 0 3.868 3.868l.5-.5a.8.8 0 0 1 1.132 1.132l-.5.5a4.336 4.336 0 0 1-6.132-6.132l3.997-3.997a4.3 4.3 0 0 1 1.403-.952" />
  ),
  "paint-brush": (
    <>
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M4.25 2.5h15.5v6.6H4.25zm2.15 0 .65 4.75L8.15 2.5zm4.05 0 .9 5.25 1.05-5.25zm4.2 0 .75 4.7 1.2-4.7z" />
      <path fill="currentColor" d="M4.25 10.1h15.5v1.25H4.25z" />
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M4.25 12.25h15.5v2.45H4.25zm.85.8h9.15L5.1 14z" />
      <path fill="currentColor" d="M4.25 15.65h15.5v1.25H4.25z" />
      <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M5.25 17.75h13.5c-.12.92-.82 1.48-1.86 1.63l-2.54.37a.93.93 0 0 0-.76 1.14l.72 2.72a.55.55 0 0 1-.86.58L12 23.07l-1.45 1.12a.55.55 0 0 1-.86-.58l.72-2.72a.93.93 0 0 0-.76-1.14l-2.54-.37c-1.04-.15-1.74-.71-1.86-1.63M12 20.1a1.28 1.28 0 1 0 0 2.56 1.28 1.28 0 0 0 0-2.56" />
    </>
  ),
  pin: (
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M8.411 2.029c-1.662 0-2.436 2.06-1.185 3.154l1.656 1.449a.2.2 0 0 1 .068.15v3.034c-.614.322-1.343.833-2.015 1.421-.875.766-1.772 1.765-2.208 2.814a1.43 1.43 0 0 0 .237 1.505c.318.37.795.573 1.286.573h4.95v5.067a.8.8 0 0 0 1.6 0V16.13h4.95a1.7 1.7 0 0 0 1.286-.573c.335-.39.468-.95.237-1.505-.436-1.05-1.333-2.048-2.208-2.814-.672-.588-1.401-1.099-2.015-1.42V6.781a.2.2 0 0 1 .068-.15l1.656-1.449c1.25-1.094.477-3.154-1.186-3.154zm-.131 1.95a.2.2 0 0 1-.066-.102.2.2 0 0 1 .01-.119.2.2 0 0 1 .07-.096.2.2 0 0 1 .117-.033h7.178a.2.2 0 0 1 .117.033.2.2 0 0 1 .07.096.2.2 0 0 1 .01.119.2.2 0 0 1-.066.102l-1.655 1.449a1.8 1.8 0 0 0-.615 1.354v3.547a.8.8 0 0 0 .52.749c.434.163 1.239.66 2.042 1.363.752.658 1.399 1.406 1.723 2.088H6.265c.324-.681.971-1.43 1.723-2.088.803-.702 1.607-1.2 2.043-1.363a.8.8 0 0 0 .519-.75V6.783a1.8 1.8 0 0 0-.615-1.354z" />
  ),
  "picture-in-picture": (
    <path fill="currentColor" d="M19 4a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM5 5.7A1.3 1.3 0 0 0 3.7 7v10A1.3 1.3 0 0 0 5 18.3h14a1.3 1.3 0 0 0 1.3-1.3V7A1.3 1.3 0 0 0 19 5.7zm12.597 4.866a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z" />
  ),
  "puzzle-piece": puzzlePieceIcon,
  "product-bookmarks": (
    <path fill="currentColor" d="M20.62 19.96h-.59a7.6 7.6 0 0 1 0-3.08h.59a.77.77 0 1 0 0-1.54V3.89c0-.77-.63-1.39-1.4-1.39H5.953C4.552 2.5 3.39 3.57 3.39 4.92v13.5c0 1.7 1.402 3.08 3.123 3.08H20.62a.77.77 0 1 0 0-1.54M9.715 4.04h4.625v5.3l-1.822-1.49a.784.784 0 0 0-.98 0L9.713 9.34zm8.744 15.92H6.514c-.88 0-1.581-.69-1.581-1.54s.7-1.54 1.581-1.54h11.944a9.4 9.4 0 0 0 0 3.08m.621-4.62H6.514c-.58 0-1.12.17-1.581.44V4.92c0-.48.45-.89 1.03-.89h2.22v6.92c0 .65.76 1.01 1.261.59l2.593-2.12 2.592 2.12c.5.41 1.261.05 1.261-.59V4.04h3.21v11.31z" />
  ),
  "radio-checked": (
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0m1.5 0c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2s10 4.477 10 10m-10 6a6 6 0 1 0 0-12 6 6 0 0 0 0 12" />
  ),
  rss: (
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M4 4.866C4 4.388 4.388 4 4.866 4h.714C13.544 4 20 10.456 20 18.42v.714a.866.866 0 1 1-1.732 0v-.714c0-7.007-5.68-12.688-12.688-12.688h-.714A.866.866 0 0 1 4 4.866m0 6.42c0-.478.388-.866.866-.866h.714a8 8 0 0 1 8 8v.714a.866.866 0 1 1-1.733 0v-.714a6.27 6.27 0 0 0-6.267-6.267h-.714A.866.866 0 0 1 4 11.287m0 7.134a1.58 1.58 0 1 1 3.16 0 1.58 1.58 0 0 1-3.16 0" />
  ),
  screenshot: (
    <path fill="currentColor" d="M2.8 16.6a.8.8 0 0 1 .8.8v1.8a1.2 1.2 0 0 0 1.2 1.2h1.8a.8.8 0 1 1 0 1.6H4.8A2.8 2.8 0 0 1 2 19.2v-1.8a.8.8 0 0 1 .8-.8m11 3.8a.8.8 0 1 1 0 1.6h-3.6a.8.8 0 0 1 0-1.6zm7.4-3.8a.8.8 0 0 1 .8.8v1.8a2.8 2.8 0 0 1-2.8 2.8h-1.8a.8.8 0 1 1 0-1.6h1.8a1.2 1.2 0 0 0 1.2-1.2v-1.8a.8.8 0 0 1 .8-.8m-7.87-9.764c.383 0 .75.152 1.022.423l1.08 1.08c.27.27.638.423 1.021.423h.602c.798 0 1.445.647 1.445 1.445v4.816c0 .798-.648 1.445-1.445 1.445H6.945A1.445 1.445 0 0 1 5.5 15.023v-4.816c0-.798.647-1.445 1.445-1.445h.606c.383 0 .75-.152 1.021-.423l1.08-1.08a1.45 1.45 0 0 1 1.022-.423zm-1.328 2.408a2.89 2.89 0 1 0 0 5.78 2.89 2.89 0 0 0 0-5.78M2.8 9.4a.8.8 0 0 1 .8.8v3.6a.8.8 0 1 1-1.6 0v-3.6a.8.8 0 0 1 .8-.8m18.4 0a.8.8 0 0 1 .8.8v3.6a.8.8 0 0 1-1.6 0v-3.6a.8.8 0 0 1 .8-.8m-9.198 1.288a1.446 1.446 0 1 1 0 2.892 1.446 1.446 0 0 1 0-2.892M6.6 2a.8.8 0 1 1 0 1.6H4.8a1.2 1.2 0 0 0-1.2 1.2v1.8a.8.8 0 1 1-1.6 0V4.8A2.8 2.8 0 0 1 4.8 2zm12.6 0A2.8 2.8 0 0 1 22 4.8v1.8a.8.8 0 1 1-1.6 0V4.8a1.2 1.2 0 0 0-1.2-1.2h-1.8a.8.8 0 1 1 0-1.6zm-5.4 0a.8.8 0 0 1 0 1.6h-3.6a.8.8 0 1 1 0-1.6z" />
  ),
  search: (
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M10.498 2a8.498 8.498 0 1 0 5.843 14.67l4.292 4.291a.8.8 0 1 0 1.131-1.13l-4.367-4.368A8.498 8.498 0 0 0 10.499 2M3.6 10.498a6.898 6.898 0 1 1 13.797 0 6.898 6.898 0 0 1-13.797 0" />
  ),
  settings: (
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M8.75 3.63C8.907 2.69 9.72 2 10.675 2h2.65c.955 0 1.769.69 1.925 1.63l.219 1.31c.017.104.095.23.256.319q.127.07.25.145c.157.095.306.1.405.062L17.624 5a1.95 1.95 0 0 1 2.374.852l1.325 2.296a1.95 1.95 0 0 1-.45 2.482l-1.026.845c-.081.067-.151.198-.148.38a8 8 0 0 1 0 .29c-.003.182.067.313.148.38l1.027.845c.736.606.926 1.656.45 2.482l-1.326 2.296a1.95 1.95 0 0 1-2.375.852l-1.243-.466c-.099-.037-.248-.033-.405.062q-.123.075-.25.145c-.16.089-.24.215-.256.32l-.219 1.309A1.95 1.95 0 0 1 13.326 22h-2.652c-.953 0-1.767-.69-1.924-1.63l-.218-1.31c-.018-.104-.096-.23-.256-.319a8 8 0 0 1-.251-.145c-.157-.095-.306-.1-.405-.062L6.377 19a1.95 1.95 0 0 1-2.375-.852l-1.325-2.296a1.95 1.95 0 0 1 .45-2.482l1.026-.845.51.619-.51-.619c.081-.067.151-.198.148-.38a8 8 0 0 1 0-.29c.003-.182-.067-.313-.148-.38l-1.027-.845a1.95 1.95 0 0 1-.45-2.482l1.326-2.296A1.95 1.95 0 0 1 6.377 5l1.243.466c.1.037.248.033.405-.062q.124-.075.25-.145c.161-.089.24-.215.257-.32zm1.925-.027a.35.35 0 0 0-.344.29l-.218 1.31c-.11.66-.543 1.171-1.061 1.458a6 6 0 0 0-.199.115c-.507.306-1.167.426-1.795.191l-1.244-.466a.35.35 0 0 0-.424.152L4.065 8.95a.35.35 0 0 0 .08.444l1.027.845c.516.425.742 1.054.731 1.647a6 6 0 0 0 0 .23c.011.593-.215 1.222-.731 1.647l-1.027.845-.51-.618.51.618a.35.35 0 0 0-.08.444l1.325 2.296a.35.35 0 0 0 .424.152l1.244-.466c.628-.235 1.288-.115 1.795.191q.099.06.199.115c.518.287.95.797 1.06 1.458l.219 1.31a.35.35 0 0 0 .344.29h2.65a.35.35 0 0 0 .344-.29l.219-1.31c.11-.66.543-1.171 1.06-1.458a6 6 0 0 0 .199-.115c.508-.306 1.167-.426 1.795-.191l1.244.466c.16.06.339-.005.424-.152l1.325-2.296a.35.35 0 0 0-.08-.444l-1.026-.845c-.517-.425-.743-1.054-.732-1.647a6 6 0 0 0 0-.23c-.011-.593.215-1.222.732-1.647l1.026-.845a.35.35 0 0 0 .08-.444L18.61 6.653a.35.35 0 0 0-.424-.152l-1.244.466c-.628.235-1.287.115-1.795-.191a6 6 0 0 0-.199-.115c-.518-.287-.95-.797-1.06-1.458l-.219-1.31a.35.35 0 0 0-.343-.29zM12 9.735a2.265 2.265 0 1 0 0 4.53 2.265 2.265 0 0 0 0-4.53M8.132 12a3.868 3.868 0 1 1 7.735 0 3.868 3.868 0 0 1-7.735 0" />
  ),
  shield: (
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M11.905 3.62 5.486 6.473a.23.23 0 0 0-.138.214v4.31c0 4.275 2.884 8.22 6.652 9.346 3.768-1.125 6.653-5.07 6.653-9.346v-4.31a.23.23 0 0 0-.14-.214L12.096 3.62a.23.23 0 0 0-.19 0m-.65-1.462a1.83 1.83 0 0 1 1.49 0l6.419 2.853c.662.294 1.089.95 1.089 1.676v4.31c0 5.089-3.521 9.848-8.253 11.003-4.731-1.155-8.252-5.914-8.252-11.003v-4.31c0-.725.426-1.382 1.089-1.676z" />
  ),
  "star-outline": (
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M10.742 3.191c.465-1.119 2.05-1.119 2.516 0l2.07 4.978 5.374.43c1.208.098 1.698 1.605.777 2.394L17.385 14.5l1.251 5.244c.281 1.178-1.001 2.11-2.035 1.478L12 18.412l-4.6 2.81c-1.035.632-2.317-.3-2.036-1.479l1.25-5.243-4.093-3.507c-.92-.789-.431-2.296.777-2.393l5.374-.431zM12 4.333l-1.907 4.584c-.196.472-.64.794-1.149.835l-4.949.397 3.77 3.23c.389.332.558.854.44 1.35l-1.152 4.83 4.237-2.588a1.36 1.36 0 0 1 1.42 0l4.237 2.588-1.152-4.83a1.36 1.36 0 0 1 .44-1.35l3.77-3.23-4.95-.397a1.36 1.36 0 0 1-1.148-.835z" />
  ),
  terminal: (
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M2.02 5.88a3.095 3.095 0 0 1 3.095-3.095h13.77A3.095 3.095 0 0 1 21.98 5.88v12.24a3.095 3.095 0 0 1-3.095 3.095H5.115A3.095 3.095 0 0 1 2.02 18.12zm3.095-1.495c-.826 0-1.495.67-1.495 1.495v12.24c0 .826.67 1.495 1.495 1.495h13.77c.826 0 1.495-.67 1.495-1.495V5.88c0-.826-.67-1.495-1.495-1.495zm.89 2.545a.8.8 0 0 1 1.12-.16l3.06 2.295a.8.8 0 0 1 0 1.28l-3.06 2.295a.8.8 0 0 1-.96-1.28l2.207-1.655L6.165 8.05a.8.8 0 0 1-.16-1.12m4.43 5.07a.8.8 0 0 1 .8-.8h3.06a.8.8 0 1 1 0 1.6h-3.06a.8.8 0 0 1-.8-.8" />
  ),
  trash: (
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M9 2a1 1 0 0 0-1 1v.578H4a.8.8 0 1 0 0 1.6h.65v14.196a2.6 2.6 0 0 0 2.6 2.6h9.5a2.6 2.6 0 0 0 2.6-2.6V5.178H20a.8.8 0 0 0 0-1.6h-4V3a1 1 0 0 0-1-1zM6.25 5.202v14.172a1 1 0 0 0 1 1h9.5a1 1 0 0 0 1-1V5.202zM10.8 8.59a.8.8 0 0 0-1.6 0v8.397a.8.8 0 0 0 1.6 0zm3.2-.8a.8.8 0 0 1 .8.8v8.397a.8.8 0 0 1-1.6 0V8.59a.8.8 0 0 1 .8-.8" />
  ),
  "warning-triangle-outline": (
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M10.793 5.234a1.393 1.393 0 0 1 2.414 0l7.065 12.247a1.393 1.393 0 0 1-1.207 2.089H4.935a1.393 1.393 0 0 1-1.207-2.09zm3.745-.768c-1.127-1.955-3.949-1.955-5.076 0L2.396 16.713c-1.127 1.953.283 4.394 2.539 4.394h14.13c2.256 0 3.665-2.44 2.538-4.394zM12 8.207a.77.77 0 0 1 .77.77v3.846a.77.77 0 0 1-1.54 0V8.977a.77.77 0 0 1 .77-.77m1.1 7.947a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0" />
  )
}

interface LeoIconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: LeoIconName
  size?: number | string
  title?: string
}

export function LeoIcon({ name, size = 16, title, className, ...props }: LeoIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      width={size}
      height={size}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      className={className}
      {...props}
    >
      {title && <title>{title}</title>}
      {ICONS[name]}
    </svg>
  )
}

type LeoButtonVariant =
  | "neutral"
  | "primary"
  | "danger"
  | "success"
  | "ghost"
  | "warning"
type LeoButtonSize = "xs" | "sm" | "md" | "icon-sm" | "icon-md"

interface LeoButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  size?: LeoButtonSize
  variant?: LeoButtonVariant
}

const buttonSizes: Record<LeoButtonSize, string> = {
  xs: "text-[11px] px-2 py-1",
  sm: "text-xs px-3 py-1.5",
  md: "text-sm px-3 py-2",
  "icon-sm": "p-1.5",
  "icon-md": "p-2"
}

const buttonVariants: Record<LeoButtonVariant, string> = {
  neutral: "bg-accent/60 text-fg/70 hover:bg-accent hover:text-fg",
  primary: "bg-primary/15 text-primary hover:bg-primary/25",
  danger: "bg-destructive/15 text-destructive hover:bg-destructive/25",
  success: "bg-success/15 text-success hover:bg-success/25",
  ghost: "text-fg/50 hover:bg-accent hover:text-fg",
  warning: "bg-warning/15 text-warning hover:bg-warning/25"
}

const buttonActiveVariants: Record<LeoButtonVariant, string> = {
  neutral: "bg-accent text-fg",
  primary: "bg-primary/20 text-primary ring-1 ring-primary/35",
  danger: "bg-destructive/20 text-destructive ring-1 ring-destructive/30",
  success: "bg-success/20 text-success ring-1 ring-success/35",
  ghost: "bg-accent text-fg",
  warning: "bg-warning/20 text-warning ring-1 ring-warning/35"
}

export function LeoButton({
  active = false,
  className,
  size = "sm",
  variant = "neutral",
  type = "button",
  ...props
}: LeoButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md whitespace-nowrap transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        buttonSizes[size],
        active ? buttonActiveVariants[variant] : buttonVariants[variant],
        className
      )}
      {...props}
    />
  )
}

interface LeoIconButtonProps extends LeoButtonProps {
  icon: LeoIconName
  iconSize?: number
}

export function LeoIconButton({
  icon,
  iconSize = 14,
  children,
  size = "icon-sm",
  ...props
}: LeoIconButtonProps) {
  return (
    <LeoButton size={size} {...props}>
      <LeoIcon name={icon} size={iconSize} />
      {children}
    </LeoButton>
  )
}

type LeoBadgeVariant =
  | "neutral"
  | "primary"
  | "danger"
  | "success"
  | "warning"
  | "info"

interface LeoBadgeProps {
  children: ReactNode
  className?: string
  title?: string
  variant?: LeoBadgeVariant
}

const badgeVariants: Record<LeoBadgeVariant, string> = {
  neutral: "bg-fg/5 text-fg/50 border-border",
  primary: "bg-primary/10 text-primary border-primary/20",
  danger: "bg-destructive/10 text-destructive border-destructive/20",
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  info: "bg-info/10 text-info border-info/20"
}

export function LeoBadge({
  children,
  className,
  title,
  variant = "neutral"
}: LeoBadgeProps) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] leading-4",
        badgeVariants[variant],
        className
      )}
    >
      {children}
    </span>
  )
}

interface LeoSwitchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type"> {
  onChange: (checked: boolean) => void
}

export function LeoSwitch({
  checked,
  disabled,
  onChange,
  className,
  "aria-label": ariaLabel,
  ...props
}: LeoSwitchProps) {
  return (
    <label className={cx("relative inline-flex items-center", disabled ? "cursor-not-allowed" : "cursor-pointer", className)}>
      <input
        {...props}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="peer sr-only"
      />
      <span
        className={cx(
          "h-[22px] w-10 rounded-full bg-secondary transition-colors",
          "peer-checked:bg-info/70 peer-disabled:opacity-30",
          "after:absolute after:left-[2px] after:top-[2px] after:h-[18px] after:w-[18px]",
          "after:rounded-full after:bg-white after:shadow-md after:transition-transform after:content-['']",
          "peer-checked:after:translate-x-[18px]"
        )}
      />
    </label>
  )
}

interface LeoTabButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
}

export function LeoTabButton({
  active = false,
  className,
  type = "button",
  ...props
}: LeoTabButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "px-3 py-2 text-xs transition-colors border-b-2 -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active
          ? "border-primary text-fg"
          : "border-transparent text-fg/40 hover:text-fg",
        className
      )}
      {...props}
    />
  )
}
