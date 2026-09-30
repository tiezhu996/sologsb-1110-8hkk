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
| 路由 | Vue Router 4（5 条业务路由 + 404） |
| 状态 | Pinia（boardStore / chamberStore / lacquerStore / stringingStore / revisionStore） |
| 存储 | IndexedDB（Dexie，库名 `gbguqin-db`，schema v3：工作台/封存修订分权） |
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
│       ├── types/             # wood-board / sound-chamber / lacquer-layer / stringing / revision（+ ui.ts）
│       ├── stores/            # board / chamber / lacquer / stringing / revision（修订所有权）
│       ├── components/common/ # DimensionChart / LayerStack / ToneTextEditor / FilterBar / StatBadge / ProcessTimeline / EmptyPanel / RevisionBar
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

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbguqin-db`），表：`boards`、`chambers`、`lacquers`、`stringings`、`revisions`、`meta`。
- `db.version(1)` 建表声明索引；`db.version(2)` 为髹漆表增加 `[guqinNo+seq]` 复合索引并回填历史厚度；`db.version(3)` 引入**工作台 / 封存修订两套数据所有权**。
  - 四类记录都带 `revisionId`，只归属一份修订；`revisions` 表记录修订号（R001…）、`draft/sealed` 状态、封存时间/封存人/说明。
  - 工作台始终只有唯一一份 `draft`，板材 / 槽腹 / 髹漆 / 上弦的增删改只写在它上面；顶栏「封存并开新修订」在一笔事务内把当前 draft 置为只读 `sealed`，并把四类记录整体复制进新开的 draft——旧验收结果留在封存修订中，不会被新数据顶掉。
  - 顶栏修订选择器可随时切到任意历史封存修订查看（四类页面自动变为只读）；继续施工点「回到当前工作台」或封存当前修订。
  - 旧库升级到 v3 时，四类旧记录在同一笔原生 `versionchange` 事务内整体落进初版 R001（draft）；校验不过（如旧档主键缺失）会整笔中止并回退到完整旧档，下次打开不会出现半套新库。
  - 首页进度、灰胎累计厚度、导出备份均按当前查看修订统计，备份 JSON 内含 `revisions` 及每条记录的 `revisionId`，文件名带当前修订号。
- 首次打开且库内无修订时写入一批示例工序档案（`src/utils/seed.ts`），初版修订与四类示例记录在同一事务内落库。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
