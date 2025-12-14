console.log('=== 测试直接导入 ai-transformer ===\n');

try {
  console.log('1. 尝试导入插件...');
  const module = await import('../packages/core/src/plugins/ai-transformer/index.ts');
  console.log('✅ 导入成功！');
  console.log('导出的内容:', Object.keys(module));

  if (module.AITransformerPlugin) {
    console.log('\n2. 检查 AITransformerPlugin 类...');
    console.log('类名:', module.AITransformerPlugin.name);
    console.log('是否有 configSchema:', 'configSchema' in module.AITransformerPlugin);

    if (module.AITransformerPlugin.configSchema) {
      console.log('configSchema:', JSON.stringify(module.AITransformerPlugin.configSchema, null, 2));
    }

    console.log('\n3. 尝试创建实例（不传参数）...');
    try {
      const instance = new module.AITransformerPlugin({});
      console.log('❌ 意外成功了？');
    } catch (error: any) {
      console.log('✅ 预期的错误（需要参数）:', error.message);
    }

    console.log('\n4. 尝试创建实例（传入正确参数）...');
    try {
      const instance = new module.AITransformerPlugin({ from: 'anthropic', to: 'openai' });
      console.log('✅ 创建成功！');
      console.log('实例 name:', instance.name);
      console.log('实例 version:', instance.version);
    } catch (error: any) {
      console.log('❌ 创建失败:', error.message);
    }
  }

  console.log('\n5. 检查 default 导出...');
  if (module.default) {
    console.log('✅ 有 default 导出');
    console.log('default 导出类型:', typeof module.default);
    console.log('default === AITransformerPlugin:', module.default === module.AITransformerPlugin);
  } else {
    console.log('❌ 没有 default 导出');
  }

} catch (error: any) {
  console.log('❌ 导入失败！');
  console.log('错误:', error.message);
  console.log('错误堆栈:', error.stack);
}
