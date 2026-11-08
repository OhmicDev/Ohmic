// The settings the demo light package adds once its script runs, described the
// way a real package does it: VESC Tool parameter XML.

/** A demo package's script carries this marker; the simulator then offers the settings below. */
export const DEMO_CONFIG_MARKER = '; ohmic-demo: lights-config'

const param = (name: string, body: string) => `        <${name}>\n${body}\n        </${name}>`

export const DEMO_LIGHTS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ConfigParams>
    <Params>
${param(
  'lights_mode',
  `            <longName>Light mode</longName>
            <type>4</type>
            <transmittable>1</transmittable>
            <description>When the headlight is on. Auto turns it on above the speed below.</description>
            <cDefine>CFG_LIGHTS_MODE</cDefine>
            <valInt>2</valInt>
            <enumNames>Off</enumNames>
            <enumNames>Always on</enumNames>
            <enumNames>Auto</enumNames>
            <vTx>1</vTx>`,
)}
${param(
  'lights_brightness',
  `            <longName>Brightness</longName>
            <type>1</type>
            <transmittable>1</transmittable>
            <description>Headlight brightness.</description>
            <cDefine>CFG_LIGHTS_BRIGHTNESS</cDefine>
            <editorDecimalsDouble>0</editorDecimalsDouble>
            <editorScale>1</editorScale>
            <editAsPercentage>1</editAsPercentage>
            <maxDouble>1</maxDouble>
            <minDouble>0.1</minDouble>
            <stepDouble>0.05</stepDouble>
            <valDouble>0.8</valDouble>
            <vTx>9</vTx>`,
)}
${param(
  'lights_auto_speed',
  `            <longName>Auto-on speed</longName>
            <type>1</type>
            <transmittable>1</transmittable>
            <description>In Auto mode, the light comes on above this speed.</description>
            <cDefine>CFG_LIGHTS_AUTO_SPEED</cDefine>
            <editorDecimalsDouble>1</editorDecimalsDouble>
            <editorScale>3.6</editorScale>
            <editAsPercentage>0</editAsPercentage>
            <maxDouble>15</maxDouble>
            <minDouble>0</minDouble>
            <stepDouble>0.1</stepDouble>
            <valDouble>1.5</valDouble>
            <suffix> km/h</suffix>
            <vTx>9</vTx>`,
)}
${param(
  'lights_brake_flash',
  `            <longName>Flash when braking</longName>
            <type>5</type>
            <transmittable>1</transmittable>
            <description>Flash the tail light while the brake lever is pulled.</description>
            <cDefine>CFG_LIGHTS_BRAKE_FLASH</cDefine>
            <valInt>1</valInt>
            <vTx>1</vTx>`,
)}
    </Params>
    <SerOrder>
        <ser>lights_mode</ser>
        <ser>lights_brightness</ser>
        <ser>lights_auto_speed</ser>
        <ser>lights_brake_flash</ser>
    </SerOrder>
    <Grouping>
        <group>
            <groupName>Lights</groupName>
            <subgroup>
                <subgroupName>Headlight</subgroupName>
                <subgroupParams>
                    <param>lights_mode</param>
                    <param>lights_brightness</param>
                    <param>lights_auto_speed</param>
                    <param>::sep::Tail light</param>
                    <param>lights_brake_flash</param>
                </subgroupParams>
            </subgroup>
        </group>
    </Grouping>
</ConfigParams>
`
