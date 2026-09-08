# 沪上前端通勤图

子项目：`housing-lancy-site`（上海房屋攻略地图）

- GitHub 仓库：https://github.com/robin-fc/housing-lancy-site
- 目标域名：https://housing.lancy.site
- 部署平台：Vercel，构建命令 `pnpm build`，输出目录 `dist`。

基于 Leaflet 的上海岗位分布与地铁通勤初筛工具。当前内置 2026-09-02 整理的 8 个公开招聘办公点样本，支持 AI 前端、Web3 / 区块链前端筛选，以及预设或自选居住点的地铁通勤估算。

## 本地运行

```bash
pnpm install
pnpm dev
```

生产构建：

```bash
pnpm build
```

本地预览生产构建：`pnpm preview`（默认端口 4173）。项目目前没有配置 lint 或自动化测试命令。

## 部署

在 Vercel 导入上述 GitHub 仓库，框架选择 Vite，并绑定 `housing.lancy.site`。依赖安装使用 `pnpm install --frozen-lockfile`；推送到 `main` 分支后自动部署。

在域名服务商为 `housing` 添加 Vercel 项目 Domains 页面指定的 CNAME 记录。本站不需要后端服务或环境变量。

## 数据说明

- 底图使用高德瓦片，仅加载与上海外环范围、当前视口相交的瓦片，边界瓦片按外环轮廓裁剪。滚轮缩放支持 10–18 级，缩放结束后按当前级别加载可视区域细节，不保留额外的视口外缓冲瓦片。
- 上海地铁站点和线路经纬度整理自 `madneal/subway-shanghai` 的本地 Amap 数据。
- 外环、中环、内环范围默认显示，可在右上角分别开关。轮廓由 [OpenStreetMap](https://www.openstreetmap.org/copyright) 道路坐标简化生成，按方位采样并插值补齐少量缺口，再转换到高德底图使用的 GCJ-02 坐标系；仅供片区范围参考。数据与来源保存在 `src/data/rings.json`，遵循 ODbL 1.0。
- 岗位与招聘来源记录在 `src/data/jobs.js`，其中部分办公点只能确认到园区或区域，页面会标注位置精度。
- 通勤时间由步行、线路区间行驶和换乘惩罚估算，不包含候车拥挤、出入口距离和实时运营情况，只适合比较片区，不适合作为精确导航。
