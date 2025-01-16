<script setup>
import { ref } from 'vue';
import { ipcRenderer } from 'electron';

const oscIp = ref('127.0.0.1');
const oscPort = ref(9000);
const hrConnectedPath = ref('/avatar/parameters/hr_connected');
const hrPercentPath = ref('/avatar/parameters/hr_percent');
const maxHeartRate = ref(200);

const saveSettings = () => {
    ipcRenderer.send('configure-osc', {
        ip: oscIp.value,
        port: parseInt(oscPort.value, 10),
        paths: {
            hrConnected: hrConnectedPath.value,
            hrPercent: hrPercentPath.value
        },
        maxHr: parseInt(maxHeartRate.value, 10)
    });
};
</script>

<template>
    <div class="container">
        <div class="header">
            <h2 class="title">应用设置</h2>
        </div>
        <div class="content">
            <div class="form">
                <label for="osc-ip">OSC IP 地址:</label>
                <input id="osc-ip" v-model="oscIp" type="text" placeholder="127.0.0.1"/>
                
                <label for="osc-port">OSC 端口:</label>
                <input id="osc-port" v-model="oscPort" type="number" placeholder="9000"/>
                
                <label for="hr-connected-path">心率连接状态路径:</label>
                <input id="hr-connected-path" v-model="hrConnectedPath" type="text" placeholder="/avatar/parameters/hr_connected"/>
                
                <label for="hr-percent-path">心率百分比路径:</label>
                <input id="hr-percent-path" v-model="hrPercentPath" type="text" placeholder="/avatar/parameters/hr_percent"/>
                
                <label for="max-heart-rate">最大心率:</label>
                <input id="max-heart-rate" v-model="maxHeartRate" type="number" placeholder="200"/>
                
                <button @click="saveSettings">保存设置</button>
            </div>
        </div>
    </div>
</template>

<style>
/* 添加你的样式 */
</style>
