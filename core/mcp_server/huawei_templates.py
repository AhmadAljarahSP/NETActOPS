# TTP templates for Huawei VRP CLI output parsing

HUAWEI_TEMPLATES = {
    "display ospf peer": """
<group name="ospf_neighbors">
 Area: {{ area_id }}
 Router ID: {{ neighbor_id }} Address: {{ neighbor_ip }}
 State: {{ state }} Mode: {{ mode }} Priority: {{ priority }}
</group>
<group name="ospf_neighbors">
 {{ area_id }} {{ local_interface }} {{ neighbor_id }} {{ state }}
</group>
""",

    "display ospf peer brief": """
<group name="ospf_neighbors">
 {{ area_id }} {{ local_interface }} {{ neighbor_id }} {{ state }}
</group>
""",

    "display lldp neighbor brief": """
<group name="lldp_neighbors">
{{ local_interface }} {{ ex_id | digit }} {{ neighbor_interface }} {{ neighbor_device_id }}
</group>
""",

    "display ip interface brief": """
<group name="interfaces">
{{ interface }} {{ ip_address }} {{ physical }} {{ protocol }}
</group>
""",

    "display bgp peer": """
 BGP local router ID : {{ local_router_id }}
 Local AS number : {{ local_as | digit }}
<group name="bgp_peers">
  {{ peer_ip }} {{ version | digit }} {{ asn | digit }} {{ msg_rcvd | digit }} {{ msg_sent | digit }} {{ out_q | digit }} {{ up_down }} {{ state }} {{ pref_rcv | digit }}
</group>
"""
}
