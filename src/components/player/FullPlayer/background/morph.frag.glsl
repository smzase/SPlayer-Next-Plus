precision highp float;
varying vec2 v_uv;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform sampler2D u_flow;
uniform float u_progress;

void main() {
    vec2 flow = texture2D(u_flow, v_uv).rg * 0.4 - 0.2;
    float p = u_progress;
    vec3 from = texture2D(u_from, v_uv - p * flow).rgb;
    vec3 to = texture2D(u_to, v_uv + (1.0 - p) * flow).rgb;
    // 对齐中的轮廓共享一条形变路径，端点与原渲染器的实时画面完全一致
    gl_FragColor = vec4(mix(from, to, p), 1.0);
}
