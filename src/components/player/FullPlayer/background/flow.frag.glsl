precision highp float;
varying vec2 v_uv;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform sampler2D u_previous;
uniform vec2 u_step;

/**
 * 提取平滑色块，避免把金属细颗粒当作需要对齐的轮廓
 * @param image - 当前背景纹理
 * @param uv - 采样位置
 * @param radius - 平滑半径
 * @returns 平滑后的颜色特征
 */
vec3 feature(sampler2D image, vec2 uv, float radius) {
    vec2 d = vec2(radius);
    vec3 color = texture2D(image, uv).rgb * 4.0;
    color += texture2D(image, uv + vec2(d.x, 0.0)).rgb;
    color += texture2D(image, uv - vec2(d.x, 0.0)).rgb;
    color += texture2D(image, uv + vec2(0.0, d.y)).rgb;
    color += texture2D(image, uv - vec2(0.0, d.y)).rgb;
    return sqrt(max(color * 0.125, vec3(0.0)));
}

void main() {
    // 低分辨率流场做空间与时间平滑，跟随实时色块而非预设的揭幕路径
    vec2 flow = texture2D(u_previous, v_uv).rg * 0.4 - 0.2;
    vec2 neighbors = texture2D(u_previous, v_uv + vec2(u_step.x, 0.0)).rg;
    neighbors += texture2D(u_previous, v_uv - vec2(u_step.x, 0.0)).rg;
    neighbors += texture2D(u_previous, v_uv + vec2(0.0, u_step.y)).rg;
    neighbors += texture2D(u_previous, v_uv - vec2(0.0, u_step.y)).rg;
    flow = mix(flow, neighbors * 0.1 - 0.2, 0.35);
    vec2 original = flow;
    // 不同材质的亮度并不守恒，抑制无法匹配的区域，避免流场积累成大幅拉伸
    flow *= 0.92;
    for (int i = 0; i < 3; i++) {
        float radius = 0.06 / exp2(float(i));
        vec2 a = v_uv - flow * 0.5;
        vec2 b = v_uv + flow * 0.5;
        vec3 difference = feature(u_to, b, radius) - feature(u_from, a, radius);
        vec3 gx = (feature(u_to, b + vec2(radius, 0.0), radius)
                 - feature(u_to, b - vec2(radius, 0.0), radius)
                 + feature(u_from, a + vec2(radius, 0.0), radius)
                 - feature(u_from, a - vec2(radius, 0.0), radius)) / (4.0 * radius);
        vec3 gy = (feature(u_to, b + vec2(0.0, radius), radius)
                 - feature(u_to, b - vec2(0.0, radius), radius)
                 + feature(u_from, a + vec2(0.0, radius), radius)
                 - feature(u_from, a - vec2(0.0, radius), radius)) / (4.0 * radius);
        float denominator = dot(gx, gx) + dot(gy, gy) + 0.1;
        vec2 correction = vec2(dot(gx, difference), dot(gy, difference)) / denominator;
        float confidence = 0.02 / (0.02 + dot(difference, difference));
        flow -= clamp(correction, vec2(-0.018), vec2(0.018)) * confidence;
    }
    flow = clamp(mix(original, flow, 0.4), vec2(-0.12), vec2(0.12));
    // 边界保持原位，避免形变拉出画布外的颜色条带
    vec2 edge = smoothstep(vec2(0.0), vec2(0.13), v_uv)
              * smoothstep(vec2(0.0), vec2(0.13), 1.0 - v_uv);
    flow *= edge.x * edge.y;
    gl_FragColor = vec4(flow / 0.4 + 0.5, 0.0, 1.0);
}
