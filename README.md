# 古琴斫制工序记录台（gbguqin）

面向斫琴师与琴坊档案员：把面板底板材、槽腹尺寸、灰胎髹漆遍次与上弦记录串成可回溯的工序档案；音色评价只用文字填写，不做音频文件与波形处理。纯前端单页应用，数据全部保存在浏览器本地，不依赖任何后端服务或外部接口。

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21810>

停止并清理：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript（`<script setup>`） |
| 构建 | Vite 6（`npm run build` 含 `vue-tsc --noEmit` 类型检查） |
| UI | Element Plus 2 |
| 路由 | Vue Router 4（6 条业务路由 + 404） |
| 状态 | Pinia（boardStore / chamberStore / lacquerStore / stringingStore / revisionStore） |
| 存储 | IndexedDB（Dexie，库名 `gbguqin-db`） |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21810
npm run build    # 类型检查 + 生产构建
```

## 目录结构

```
.
├── docker-compose.yml         # 顶层 name / COMPOSE_PROJECT_NAME 容器名 / 端口映射
├── .env.example               # COMPOSE_PROJECT_NAME、FRONTEND_PORT
├── frontend/
│   ├── Dockerfile             # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf             # try_files SPA 回退 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/             # wood-board / sound-chamber / lacquer-layer / stringing（+ ui.ts）
│       ├── stores/            # boardStore / chamberStore / lacquerStore / stringingStore
│       ├── components/common/ # DimensionChart / LayerStack / ToneTextEditor / FilterBar / StatBadge / ProcessTimeline / EmptyPanel
│       ├── hooks/             # useGuqinFilter / useStageProgress
│       ├── pages/             # WorkshopBoard / BoardList / ChamberEditor / LacquerLedger / StringingLog（+ NotFound）
│       ├── router/index.ts    # 路由表
│       └── utils/             # layer.ts / db.ts / export.ts（+ wood.ts / seed.ts / id.ts）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 琴坯进度 | 选材/掏膛/灰胎/上弦四阶段统计、推进比、缺失项与工序动态 |
| `/boards` | 板材登记与配对 | 面板底板配对、含水率回显、厚度差、槽腹剖面标注 |
| `/chambers` | 槽腹尺寸记录 | 纳音/龙池/凤沼三处厚度、槽腹深度、天地柱与龙池凤沼尺寸，SVG 剖面标注 |
| `/lacquer` | 灰胎髹漆遍次 | 按遍次累加厚度、荫房温湿度窗口校验、层积条与养护天数 |
| `/stringing` | 上弦与音色评价 | 散音/按音/泛音三段纯文本评语、九德简述、缺陷标记与版本对照 |

## 数据存储说明（工作台 / 封存修订两套所有权）

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbguqin-db`），表：`boards`、`chambers`、`lacquers`、`stringings`、`revisions`、`meta`。
- **两套数据所有权**：四张工序表只保存每张琴「当前开放修订」的工作台数据（每行带 `revisionId` 归属）；`revisions` 表保存封存修订（`sealed`，内嵌四类记录只读快照）与开放修订（`open`）元数据。
- **封存**：在「修订档案」页对某琴封存当前修订——板材 / 槽腹 / 髹漆 / 上弦四类记录整体生成只读快照（旧验收结果不再被继续施工顶掉），并自动**续开下一版**工作台，复制成新 id 的行归入新版，可直接继续施工。
- **历史修订只读可查**：每个封存修订含封存时间、说明与四类快照，在档案抽屉中只读查看。
- **首页进度、灰胎累计、备份均标明当前修订**：进度表按琴显示「初版/第 N 版」与已封存数；髹漆页累计厚度标注所属修订；导出的 JSON 含 `revisions` 与 `currentRevisions` 当前修订标记。
- `db.version(3)` 为修订所有权升级：旧库在**单个 IndexedDB versionchange 事务**内迁移——旧整档落进各琴「初版」封存修订，并续开第 2 版；升级任一步失败由事务整体回滚，旧四张表原样保留，不会出现半套新库。`version(2)` 为髹漆表增加 `[guqinNo+seq]` 复合索引并回填历史厚度。升级前可用顶栏「导出备份」导出全量 JSON（导入兼容无 `revisions` 的旧版备份，会按初版重建）。
- 首次打开且库为空时写入一批示例工序档案（`src/utils/seed.ts`），示例琴自带初版开放修订。
- 迁移与封存语义有内存集成测试（fake-indexeddb）：`cd frontend && npm test`（`scripts/revision.test.ts` 29 项、`scripts/migration-rollback.test.ts` 8 项断言）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
