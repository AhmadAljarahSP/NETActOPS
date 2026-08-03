# Known-Issues - Recurring Outages and Bugs

A living registry of outstanding multi-vendor firmware issues, packet drop behaviors, and routing anomalies.

## Active Issues
1. **Huawei VRP RADIUS Authentication Loopback Bug**
   - **Symptom:** Discovered devices fail SSH auth check.
   - **Workaround:** Verify loopback address matches AAA config. Refer to [[Security/Access-Control-Status]].
2. **Cisco OSPF MTU Exchange Stuck**
   - **Symptom:** Neighbor state stuck in Exchange or ExStart.
   - **Workaround:** Check MTU mismatch. Refer to [[SOP/OSPF-Recovery]].
