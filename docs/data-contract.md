# 数据字段、关联与接入协议

本轮六套独立 mock 源位于 `mock/`，`feeds.json` 是它们的打包版本。封装、测试、晶圆分别附带CSV。同步读取这些源快照；模拟工厂动作会显式更新模拟源，以便下一次同步确认结果。没有外部系统连接。

|对象|主键及核心字段|关联/权威来源|
|---|---|---|
|客户|id, name|CRM，归集客户total|
|项目|id, customerId, name, stage|CRM，必须属于客户|
|完整PN|id, die, package, routeId|产品主数据；后缀不丢失|
|代理商|id, customers, stockMonths|授权客户；备货月数是mock假设|
|预测|id, version, active, customerId, projectId, pn, month, quantity|CRM，只使用有效版本|
|销售订单行|id, customerPo, customerId, projectId, dealerId, pn, quantity, cancelled, due, demandMonth, priority, allowPartial|ERP/OA；客户PO是上游订货凭证|
|采购/加工PO|id, workOrderId, lotId, supplier, kind, quantity, unit|采购侧PPO，与客户CPO分开|
|批次|id, parentId, die, pn, unit, quantity, stage, factory, sourceId, workOrderId|晶圆/封装/测试批次统一索引；保留来源编号|
|批次质量|quality, frozen, unusable, status|hold完全排除；其他冻结和不良数量扣减|
|批次日期|enteredAt, observedAt, promisedDate, promiseConfirmed, maxDwellHours|进入本站/源更新时间/工厂承诺分开|
|路线|remainingRoute[].name/queue/duration/confirmedStart|经过批准的工序主数据；周期范围按工作日计算|
|换算|grossDiePerWafer, remainingYield|按单位与剩余良率换算；缺失转换率不估造|
|供需分配|orderId,lotId,quantity,earliest,latest,onTime,firm|确定性计算，每批可用量只消耗一次|
|出货|id,orderId,lotId,quantity,time,status,receivedAt,source|实发减少订单未交；签收不二次扣减；不等同收入|
|血缘|kind,parents,children,quantity,unit,time|拆分、合并、投料、回货的数量关系|
|源快照|sourceId,eventId,observedAt,records|mock或未来连接器，只读获取后统一校验|
|异常|id,key,subject,reason,owner,status,nextCheck,notes|key去重；异常持续时保留人工反馈|
|调度|id,frequency,hour,minute,weekday,days,enabled|北京时间；同日同计划runKey唯一|

## 供应商CSV映射

`lot_no → id`、`part_number → pn`、`qty → quantity`、`uom → unit`、`operation → stage`、`factory → factory`、`source_updated_at → observedAt`、`promise_date → promisedDate`、`quality → quality`、`work_order → workOrderId`。

数量只接受非负整数；单位为wafer、die或pcs。CSV不允许自行改变PN/单位/工序/数量而不提供物料事件。未知主键进入未归因；真实上线需要先审批主数据映射。

## 服务接口

- `GET /api/state`：可信状态、派生计划、异常、证据和版本。
- `POST /api/command`：JSON `{key,command}`；`key`为持久化幂等键。同一键不同内容拒绝。
- `command.type=ingest`：传入`envelope`；通过`core/connectors.mjs`将CSV转为标准封包。
- `sync`、`tick`：确定性编排所有来源；不自动发送消息或下真实订单。
- `receipt`、`ship`、`release`、`expedite`：显式模拟业务动作，数量/质量/关联由代码校验。
- `followup`：保存人工反馈及下次复核时间。

真实连接器应只返回标准封包，不直接改数据库。当前陌生主键/结构变更隔离，不能把任意JSON写入可信表。源时间、接入时间、来源版本分别保留。并发写入用版本比较与事务；事件键数据库唯一约束。

## 当前持久化设计与上线边界

本轮是小团队演示的聚合状态：D1/SQLite保存完整业务快照和幂等事件，适合核对闭环。尚非大规模生产数据仓库；接入持续全量WIP前应把批次、快照、事件、订单、分配拆为独立表，定义保留周期和索引，避免单行体积增长。真实工厂路线、排产容量、权限及写入回执须先验证。客户按既有Sites私有权限访问，未扩展分享范围。
