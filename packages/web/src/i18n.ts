/**
 * Minimal zh/en string table. Default zh (primary audience: CN exam
 * registrations); English fallback keeps the OSS audience covered.
 */
export type Lang = "zh" | "en"

interface Entry {
  zh: string
  en: string
}

const STRINGS: Record<string, Entry> = {
  brand: { zh: "证件照工坊", en: "ID Photo Kit" },
  tagline: { zh: "照片全程不出浏览器", en: "Photos never leave your browser" },
  steps: { zh: "选规格 · 拍照/上传 · 编辑 · 导出", en: "Spec · Capture · Edit · Export" },

  // specs page
  specsTitle: { zh: "选择证件照规格", en: "Choose a photo spec" },
  specsSub: {
    zh: "搜索名称或别名（如「四六级」），或按分类浏览；也可自定义尺寸",
    en: "Search by name or alias, browse by category, or define a custom size",
  },
  searchPh: { zh: "搜索规格 / 别名…", en: "Search spec / alias…" },
  catAll: { zh: "全部", en: "All" },
  catStd: { zh: "标准", en: "Standard" },
  catExam: { zh: "考试", en: "Exam" },
  catCert: { zh: "证件", en: "Certificate" },
  catVisa: { zh: "签证", en: "Visa" },
  catJob: { zh: "求职", en: "Job" },
  catPrint: { zh: "冲印", en: "Print" },
  custom: { zh: "自定义尺寸", en: "Custom size" },
  unit: { zh: "单位", en: "Unit" },
  widthW: { zh: "宽", en: "W" },
  heightH: { zh: "高", en: "H" },
  dpiL: { zh: "DPI", en: "DPI" },
  useCustom: { zh: "使用自定义规格", en: "Use custom spec" },
  noSpecs: { zh: "没有匹配的规格", en: "No matching specs" },

  // capture page
  capTitle: { zh: "获取照片", en: "Get your photo" },
  capSub: {
    zh: "相机现拍（推荐，光线可控）或上传已有照片；处理全程在本机完成",
    en: "Shoot with the camera (recommended) or upload; everything stays on-device",
  },
  camera: { zh: "相机现拍", en: "Camera" },
  camSub: {
    zh: "正对镜头，人脸置于虚线框内，光线充足、避免眼镜反光",
    en: "Face inside the dashed oval, good lighting, avoid glasses glare",
  },
  startCam: { zh: "开启相机", en: "Start camera" },
  shutter: { zh: "拍摄", en: "Capture" },
  stopCam: { zh: "关闭", en: "Stop" },
  camDenied: {
    zh: "无法访问相机（未授权 / 不支持 / 非安全环境），请改用上传",
    en: "Camera unavailable (permission / support / insecure context); upload instead",
  },
  upload: { zh: "上传照片", en: "Upload photo" },
  upSub: { zh: "点击选择或拖拽照片到此处", en: "Click or drag a photo here" },
  upHint: {
    zh: "JPG / PNG / WebP，建议正面半身、背景尽量纯色",
    en: "JPG / PNG / WebP, front-facing half-body, plain background preferred",
  },
  demo: { zh: "没有照片？用示例照片体验 →", en: "No photo? Try the demo →" },
  procDecoding: { zh: "解码与方向矫正…", en: "Decoding & orientation…" },
  procFace: { zh: "人脸检测（MediaPipe）…", en: "Face detection (MediaPipe)…" },
  procMatte: { zh: "人像抠图（MODNet）…", en: "Portrait matting (MODNet)…" },
  procMatteSkip: {
    zh: "抠图模型不可用，跳过（换底/换装将受限）",
    en: "Matting model unavailable, skipped (bg/outfit limited)",
  },
  procDone: { zh: "就绪", en: "Ready" },

  // edit page
  editTitle: { zh: "编辑", en: "Edit" },
  editSub: {
    zh: "换背景 / 换装 / 调整位置与大小，实时对照规格",
    en: "Background, outfit, size & position — live against the spec",
  },
  tabBg: { zh: "背景", en: "Background" },
  tabOutfit: { zh: "服装", en: "Outfit" },
  tabAdj: { zh: "调整", en: "Adjust" },
  tabChk: { zh: "检查", en: "Checks" },
  bgTrans: { zh: "透明", en: "Alpha" },
  bgCustom: { zh: "自定义", en: "Custom" },
  bgCustomPh: { zh: "#RRGGBB", en: "#RRGGBB" },
  needMatte: {
    zh: "换背景/换装需要抠图模型；当前模型不可用，已保留原图背景延展。",
    en: "Background/outfit need the matting model; unavailable, keeping the original background.",
  },
  retryMatte: { zh: "重试加载模型", en: "Retry model" },
  outfitNone: { zh: "原图", en: "Original" },
  outfitSuit: { zh: "西装", en: "Suit" },
  outfitCareer: { zh: "职业装", en: "Career" },
  outfitAcademic: { zh: "学位服", en: "Academic" },
  outfitNote: {
    zh: "换装为贴片替换：以人像轮廓锚定肩线，替换服装区域。",
    en: "Outfit patching: anchored at the shoulder line of the silhouette.",
  },
  dx: { zh: "左右", en: "Pan X" },
  dy: { zh: "上下", en: "Pan Y" },
  zoom: { zh: "缩放", en: "Zoom" },
  rot: { zh: "旋转", en: "Rotate" },
  bright: { zh: "亮度", en: "Brightness" },
  contrast: { zh: "对比度", en: "Contrast" },
  resetAdj: { zh: "复位", en: "Reset" },
  chkSize: { zh: "尺寸像素", en: "Pixel size" },
  chkBg: { zh: "背景颜色", en: "Background" },
  chkFace: { zh: "人脸锚定", en: "Face-anchored" },
  chkFaceNo: { zh: "未检出人脸 — 居中裁剪兜底", en: "No face — center-crop fallback" },
  chkKB: { zh: "文件体积", en: "File size" },
  backCap: { zh: "← 重拍/换图", en: "← Reshoot / change" },
  toExport: { zh: "导出 →", en: "Export →" },
  rePick: { zh: "更换规格", en: "Change spec" },

  // export page
  expTitle: { zh: "导出", en: "Export" },
  expSub: {
    zh: "三视图预览与下载；体积压缩为真实二分计算",
    en: "Previews & downloads; KB compression is a real bisection",
  },
  single: { zh: "电子照（单张）", en: "Digital photo" },
  singleD: { zh: "报名系统上传用", en: "for online forms" },
  trans: { zh: "透明底 PNG", en: "Transparent PNG" },
  transD: { zh: "自行换底用", en: "for custom backgrounds" },
  sheet: { zh: "排版照（六寸）", en: "Print sheet (6″)" },
  sheetD: { zh: "打印裁切用，含裁切线", en: "with cut guides" },
  targetKB: { zh: "目标体积", en: "Target size" },
  dlSingle: { zh: "下载电子照 JPG", en: "Download JPG" },
  dlTrans: { zh: "下载透明底 PNG", en: "Download PNG" },
  dlSheet: { zh: "下载排版照 JPG", en: "Download sheet" },
  kbFits: { zh: "达标", en: "within target" },
  kbOver: { zh: "超出目标（已用最低可用质量）", en: "over target (lowest usable quality)" },
  restart: { zh: "↺ 重新开始", en: "↺ Start over" },
  fmtJpeg: { zh: "JPEG 质量", en: "JPEG quality" },
  tiles: { zh: "张", en: "tiles" },

  // generic
  error: { zh: "出错了", en: "Something went wrong" },
  needSpec: { zh: "请先选择规格", en: "Pick a spec first" },
  needPhoto: { zh: "请先拍照或上传照片", en: "Capture or upload a photo first" },
}

export function makeT(lang: Lang) {
  return (key: keyof typeof STRINGS | string): string => {
    const entry = STRINGS[key as string]
    return entry ? entry[lang] : (key as string)
  }
}
