# 接口

页面地址：概览在 `/`（`?time=` 同下），流水在 `/journal`（筛选参数同 `/api/journal`：`time`、`q`、`account`、`category`、
`tag`、`payee`），账户在 `/accounts`，收支表在 `/income`（`?time=` 同下，默认 `year`；手机底栏的「报表」），交易详情在 `/txn/<id>`。
同一个地址在宽屏（≥ 1024px，断点在 `web/src/layout.ts`）显示侧栏加主区，窄屏是手机布局和底部标签栏。
概览、流水、账户和收支表都有电脑版，宽屏下的账户页是资产负债表（和手机账户页同一个接口、同样的口径）。宽屏下的交易详情是流水右边的详情栏，`/txn/<id>` 后面可以跟着流水的筛选
（如 `/txn/<id>?time=all`）；窄屏的交易详情是单独一页，忽略这些参数。
侧栏的搜索框和手机首页的搜索按钮都搜全部时间（进 `/journal?time=all`）。

- `GET /api/overview?time=&recent=`：首页概览。`time` 同流水，默认 `month`；本期只算到今天（预记不算）。
  `recent` 是最近交易的笔数，默认 5（电脑端用 8）。
  返回这段时间的支出、收入、结余和储蓄率，和上一段同期比的支出变化（本月比上月同一天为止，上月比前一整月，
  今年比去年同期），按科目前三段归并的支出分类（各类加起来等于总支出），
  近 12 个月每月的收入和支出（`months`，从早到晚，最后一个月只算到今天，不随 `time` 变），
  截至今天的信用卡额度（`credit`），最近几笔交易，以及同步状态（`sync`）。
  信用卡额度：信用卡科目根（默认 `Liabilities:CreditCard`，见 `config.yaml` 的 `credit_card`）下按银行合并，
  `credit-limit`、`card-count`、`bank-name` 写在银行账户上（或每张卡写同样的值），写得不一致时 `credit.error`
  给出原因；使用率 ≥100% / ≥80% / ≥50% 分别是 `over` / `high` / `warn`，其余 `ok`。
  `credit.limit` 是有额度的卡的额度之和，`credit.used` 是所有卡的欠款之和，`credit.utilization` 和 `credit.level`
  只按有额度的卡算。
  同步状态读账本仓库的 `.git/sync-status`（格式见 README 的「同步」），没有这个文件时为 `null`。
- `GET /api/income?time=`：收支表。`time` 同流水，默认 `year`；口径同 `/api/overview`：只算到今天、只算主货币，
  支出取支出类交易的支出分录，收入只算收入类交易（消费、还款里顺带的优惠，记在转账里的投资收益都不算），
  所以收入、支出和首页同一范围的数字一致。返回收入、支出、结余、储蓄率，`capped`（范围截在了今天），
  和上一段同期比的 `compare`（规则同首页，另有上一段的收入、结余、储蓄率和收入变化；`all` 时为 `null`），
  `sides.income` / `sides.expense`：按科目前三段归并的分类再按第二段分组，组和组内都从大到小，
  每组和每类带 `previous`（上一段的金额，没有可比的上一段时为 `null`）和 `change`（百分比，上一段为零时为 `null`）；
  组名取组科目的 `name:`，没有时用英文末段；只记在组科目本身时 `children` 为空。各组加起来等于总额，金额为零的不列。
  `months` 是到所选范围最后一个月为止的 12 个月收支（同首页的 `months`），`years` 是今天及以前有交易的年份，新的在前。
- `GET /api/accounts`：账户页。截至今天的资产、负债和净资产（预记不算），比上月末的变化（`change`），
  近 12 个月每月底的净资产（`trend`，最后一个点是今天）。主货币以外的币种按当天或以前最近的 `price` 换算，
  没有价格的照列在账户的 `holdings` 里、不计入金额，汇总在 `unconverted`。`sides.assets` / `sides.liabilities`
  按科目第二段分组（分组表见 `config.yaml` 的 `groups`，分组名可用分组账户的 `name:` 覆盖），组内按前三段归并
  （信用卡按银行、投资按品种），`single` 的组（默认银行和分期）每个账户单列；余额为零的不列。归并了下面子科目的行 `merged` 为真
  （电脑端在科目后写「:*」）。负债的金额取反，欠款为正。
  第二段是 `Custody`（见 `config.yaml` 的 `custody`）的科目是替别人管的钱，不计入两边的分组和合计，按第三段分人列在 `custody` 里：
  代管资金（`Assets:Custody:<人>`，`children` 是钱放在哪些子科目）、代管款（`Liabilities:Custody:<人>`）
  和差额 `diff`（资金 − 代管款）。净资产仍按所有科目算，所以等于资产 − 负债 + 各人的差额。
- `GET /api/journal?time=&q=&account=&tag=&payee=&type=&offset=&limit=`：按日分组的流水和合计。
  `type` 可重复，取 `txn`（交易，默认）、`balance`（余额断言）、`open`（开户和销户）、`note`、`price`、`document`；
  每一项都带 `type`，交易以外的指令另有 `account`、`name`、`brand` 和按类型的字段（余额断言的 `amount`、`ok`、`actual`、`diff`，
  价格的 `currency`、`amount`、`quote` 等）。`types` 是当前筛选下各类型的条数（不含预记），不管 `type` 选了哪些；
  同一天里开户、余额断言等指令在交易下面；交易按 `time:` 元数据从晚到早，没写时间的跟同一文件里同一天前一笔有时间的
  （没有就跟后一笔，整个文件当天都没有就算最早）。
  `count` 和合计只算交易。其他指令筛科目时要落在科目之下，价格没有科目、在筛科目时不出现，筛收付方时只剩交易。
  `time` 取 `week`（本周，周一起）、`month`（默认）、`last-month`、`3months`、`year`、`all`、`YYYY`、`YYYY-MM`；
  `account` 可重复，每个科目（含子科目）都要出现；`q` 按空格拆词，每个词都要命中收付方、摘要、`#标签`或科目。
  预记（日期在今天以后的交易，如分期、订阅）不进 `days`，也不计入 `count`、`expense`、`income`，分页只对今天及以前的部分；
  它们一次全给在 `future` 里：`{count, expense, income, transfer, first, last, days}`，`days` 同上按日分组、新的在前，
  每一页都带，当前筛选下没有时为 `null`。流水页把它显示成最上面一个默认收起的「预记」组。
  每笔交易的 `sources` / `targets` 是出钱和进钱的资金科目的显示名；`funds.sources` / `funds.targets` 是同样的科目，
  带上完整科目名和账户徽标（`{account, name, brand}`）。
  交易写了车票或门票的元数据（写法见 README 的「车票和门票」）时带 `ticket`，否则为 `null`。`kind` 分两种：
  - `"train"`（车票）：`{kind, train, from, to, depart, arrive, minutes, seat, tickets, fee, refund}`。`depart`、`arrive` 是 `YYYY-MM-DD HH:MM`，
    只写了时刻的 `arrive` 补上日期（早于开车时间的算第二天）；`minutes` 是历时，没写 `arrive` 时它和 `arrive` 都是 `null`。
  - `"attraction"`（门票）：`{kind, attraction, visit, item, tickets, fee, refund}`。`visit` 是 `YYYY-MM-DD`，
    预约了入园时段的是 `YYYY-MM-DD HH:MM`；`item` 是票种。

  两种都有的：`tickets` 只在多于一张时有；`fee` 是两位小数的字符串；`refund` 为真表示退票（支出类交易金额为正，即退回的钱）。
- `GET /api/txn/<id>`：流水里其他指令的 id 也用这个地址，返回同流水里那一项的字段加 `source`、`commit`。
  交易的是：分录、源文件和行号、最后一次提交、同收付方的其他交易
  （最多 5 条：已经发生的在前，新到旧；未来日期的在后，近到远；截断时先保证已经发生的）。
- `GET /api/facets`：筛选条用的年份、账户、分类、标签和收付方；`names` 是所有开过户的科目的显示名，
  筛选标签用它（没记过账的父科目也有）。
- `GET /api/status`：账本标题、入口文件（相对账本仓库根目录，如 `books/main.bean`）、主货币、交易数、错误数、
  同步状态。电脑端侧栏每分钟取一次。同步状态（这里和 `/api/overview` 的 `sync`）另有 `can_sync`（设了 `SYNC_DIR`）
  和 `pending`（同步请求还没被 git-sync 取走）。
- `POST /api/sync`：请 git-sync 马上拉取，返回 202 和 `{"requested": "<UTC 时间，到秒>"}`。在 `$SYNC_DIR/request`
  原子地写下请求时间；已经有请求时不重写，返回原来的时间。没设 `SYNC_DIR` 时 404。
  前端点了「同步」后每 2 秒查 `/api/status`，`pending` 为假且 `sync.time` 不早于 `requested` 就算拉完，
  重新取当前页；最多等 60 秒，失败或超时在底部提示。
