# C35 S10 模拟时间部分证据

2026-10-13；S10保持未勾选，不新增items。Native77/compiler4；完整5349输入/59558239字节副本，hash `3d87c9616a895dc473d00ab2c84e4eb7064b42e79cd99f590f54f2b03e736358`，source/lib矩阵前后相等。所有临时与证据文件均在项目目录。

[准确实现、命令、原失败及范围](../../../../../.local/world-completion/c35-world-calendar-time/proof-report-20261013.md)、[实际source2](../../../../../.local/world-completion/c35-world-calendar-time/final-matrix-20261013/source.log)、[lib2](../../../../../.local/world-completion/c35-world-calendar-time/final-matrix-20261013/lib.log)、[126原件及hash](../../../../../.local/world-completion/c35-world-calendar-time/final-matrix-20261013/verified.json)与[完整运行输入](../../../../../.local/world-completion/c35-world-calendar-time/final-matrix-20261013/runtime-bytes)保留了4真实case、12独立PID、8cold0model、12 canonical posts；每warm30模型调用/10独立三工具决策。

第一岗位 occurrence 在time1冻结原requester。随后通过真实Native关系边界关闭其旧岗位、新建standby与新holder；旧wake不重选，原requester在合法现任职和原grant下真正消费。第二 occurrence 在time3选observer，原第二wake由明确管理取消，未假称该observer完成工作。制度公告/生效from4、until5；原director裁决delay3在time4消费；实际reply-deadline4后，observer的真实Agent接受操作返回 `SIM_REPLY_EXPIRED`。所有time4事件按原数字time/microstep/phase/slot排序；超horizon7、过去deadline4和clock6时新增wake5分别拒绝且不append、不调用模型。真实墙钟delay100ms不改变paused时间与已排期回应；不把wall inference/task lease当模拟deadline。

Root已阅读原审计程序，并独立执行完整126原件及frozen副本校验：

```sh
python3 .local/world-completion/c35-world-calendar-time/final-matrix-20261013/proof-programs/verify-evidence-20261013.py .local/world-completion/c35-world-calendar-time/final-matrix-20261013
```

[root实际结果](../../../../../.local/world-completion/c35-world-calendar-time/root-verify-20261013.log)exit0。该验证以真实Native/Team/Channel/Session和cold原件核对，不以stdout标签取代来源。不是SIGKILL矩阵，也未重用C25的历史Native74字节作为当前验收。

**原design8.4要求reservation到期，当前生产没有模拟expiresAt/TTL事件家族。** 因此该条尚未完整满足，S10继续未勾选。不能删掉这项范围，也不能用墙钟lease或人为取消代替。其余时间行为已有上述双后端/source-lib证据，后续需要在实际资源/岗位reservation owner完成期限与原子结算后补验。
