# 教育业务微信小程序

这是一个用于本地功能审阅的微信原生小程序项目。项目包含七个现役角色客户端、NestJS 后端、PostgreSQL、Redis、OpenAPI 契约和可重复复位的中文演示数据。

## 已实现客户端

- 家长端
- 教师端
- 分校区管理员端
- 合作方端
- 总部人力端
- 总部财务端
- 超级管理员端

当前版本用于本地演示和功能审阅。手机号验证码、微信身份、支付、退款和打款均使用 Mock 或人工流程，不代表正式微信能力或真实资金通道已经接入。

## 项目结构

- `frontend/`：微信原生小程序，主包仅包含启动页，七个角色分别使用普通分包
- `backend/`：NestJS 模块化单体后端、Prisma 数据模型、迁移、种子和测试
- `contracts/`：OpenAPI 接口契约
- `storage/`：本地文件存储挂载目录，只提交占位文件
- `docker-compose.yml`：后端、PostgreSQL、测试 PostgreSQL 和 Redis 本地环境

## 环境要求

- Docker Desktop，支持 `docker compose`
- 微信开发者工具
- 可选：Node.js 24 和通过 Corepack 启用的 pnpm，用于在宿主机执行测试

## 一、启动后端和演示数据

在项目根目录执行：

```powershell
Copy-Item .env.example .env
docker compose up -d --build
docker compose ps
docker compose exec -T backend pnpm --dir backend db:migrate:deploy
Invoke-RestMethod http://127.0.0.1:3000/health
docker compose exec -T backend pnpm --dir backend db:prepare-recording-demo
```

健康接口应返回 `data.status: ok`。演示数据准备结果应包含：

- `accountCount: 11`
- 陈晨主课时 `900`
- 陈晨赠送课时 `200`
- 一笔总部财务待录包收款

需要重新演示写入流程时，再执行一次：

```powershell
docker compose exec -T backend pnpm --dir backend db:prepare-recording-demo
```

## 二、打开微信小程序

1. 在微信开发者工具中导入 `frontend` 目录。
2. 没有项目 AppID 管理权限时，在导入界面选择自己的测试号或 AppID。
3. 确认开发者工具未校验本地请求域名；项目配置已设置 `urlCheck: false`。
4. 首次打开后，在开发者工具 Console 执行：

```javascript
wx.setStorageSync('education.runtime', {
  dataDriver: 'api',
  apiBaseUrl: 'http://127.0.0.1:3000',
  enableTestAccountSwitcher: true
})
```

5. 点击“编译”。页面应进入手机号验证码登录界面。

## 三、本地演示账号

统一验证码：`123456`

| 顺序 | 角色 | 手机号 | 演示人物与范围 |
| --- | --- | --- | --- |
| 1 | 财务 | `13800000007` | 钱会计 / 总部 |
| 2 | 家长 | `13800000001` | 陈家长 / 陈晨 / 东校区 |
| 3 | 教师 | `13800000003` | 林老师 / 东校区 |
| 4 | 管理员 | `13800000004` | 周园长 / 东校区 |
| 5 | 合作方 | `13800000002` | 朱元璋 / 东校区 |
| 6 | 人力 | `13800000006` | 何主管 / 总部 |
| 7 | 总端 | `13800000005` | 系统管理员 / 全局 |

西校区隔离对照账号：

- 家长：`13800000008`
- 教师：`13800000009`
- 管理员：`13800000010`
- 合作方：`13800000011`

每次切换角色时，从当前端“我的/设置”点击“退出登录”，再输入下一个手机号和统一验证码。

## 推荐功能审阅顺序

1. 财务给陈晨录入课包和赠课。
2. 家长查看新增课包与课时流水。
3. 教师完成当天课次并填写课堂反馈。
4. 家长查看扣课、出勤与课堂动态。
5. 分校区管理员审批陈晨的待处理请假。
6. 合作方查看本校区只读经营与收益数据。
7. 人力查看教师档案、授课、课耗和课时费报表。
8. 总端查看两校区汇总、配置与审核入口。
9. 使用西校区账号验证校区数据隔离。

## 本地验证

安装宿主机依赖：

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm --dir backend prisma:generate
```

执行主要质量门禁：

```powershell
pnpm --dir frontend check
pnpm --dir frontend assets:check
pnpm --dir backend contract:lint
pnpm --dir backend test --runInBand
pnpm --dir backend build
```

停止本地服务但保留数据库和 Redis 数据卷：

```powershell
docker compose down
```

不要把 `.env`、Token、AppSecret、商户密钥、数据库导出或本地上传文件提交到版本库。
