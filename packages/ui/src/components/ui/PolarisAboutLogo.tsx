/**
 * Polaris 占位品牌标识（北极星）。
 *
 * 设计：四角星（北极星）+ 环绕轨道，象征"指引方向"。纯 currentColor，
 * 继承文字颜色，深浅主题自动适配。占位用，拿到正式设计稿后整体替换本文件即可。
 */

export function PolarisAboutLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="118"
      height="100"
      fill="none"
      viewBox="0 0 256 218"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* 四角星主体：北极星 */}
      <path
        fill="currentColor"
        d="M128 8 L145 96 L232 113 L145 130 L128 218 L111 130 L24 113 L111 96 Z"
      />
      {/* 环绕轨道弧，象征定位/指引 */}
      <path
        fill="currentColor"
        opacity="0.45"
        d="M52 150 C88 186 168 186 204 150 C208 146 214 151 210 156 C172 196 84 196 46 156 C42 151 48 146 52 150 Z"
      />
    </svg>
  )
}

export function PolarisWordmarkLogo({ className }: { className?: string }) {
  return (
    <svg
      width="380"
      height="54"
      viewBox="0 0 380 54"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* 星形标记（左侧） */}
      <path
        fill="currentColor"
        d="M27 6 L33 21 L48 27 L33 33 L27 48 L21 33 L6 27 L21 21 Z"
      />
      {/* 字标 POLARIS（几何无衬线，粗体） */}
      <g fill="currentColor" transform="translate(60 0)">
        {/* P */}
        <path d="M4 1 H22 C32 1 38 7 38 16 C38 25 32 31 22 31 H14 V53 H4 Z M14 11 V21 H21 C26 21 28 19 28 16 C28 13 26 11 21 11 Z" />
        {/* O */}
        <path d="M44 1 H62 C72 1 78 7 78 16 V38 C78 47 72 53 62 53 H44 C34 53 28 47 28 38 V16 C28 7 34 1 44 1 Z M44 11 C39 11 38 13 38 16 V38 C38 41 39 43 44 43 H62 C67 43 68 41 68 38 V16 C68 13 67 11 62 11 Z" />
        {/* L */}
        <path d="M88 1 H98 V43 H122 V53 H88 Z" />
        {/* A */}
        <path d="M150 1 H164 L186 53 H175 L170 41 H144 L139 53 H128 Z M147 31 H167 L157 7 Z" />
        {/* R */}
        <path d="M196 1 H214 C224 1 230 7 230 16 C230 23 226 28 220 30 L232 53 H220 L209 31 H206 V53 H196 Z M206 11 V21 H213 C218 21 220 19 220 16 C220 13 218 11 213 11 Z" />
        {/* I */}
        <path d="M242 1 H252 V53 H242 Z" />
        {/* S */}
        <path d="M266 1 H288 V11 H276 C271 11 270 13 270 15 C270 17 271 19 276 19 C288 19 292 25 292 33 C292 45 285 53 270 53 H264 V43 H276 C281 43 282 41 282 39 C282 37 281 35 276 35 C264 35 260 29 260 21 C260 9 267 1 266 1 Z" />
      </g>
    </svg>
  )
}
