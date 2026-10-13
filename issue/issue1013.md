1 bug 新建一个文档，显示未命名.md，即使还未保存，左上角也显示已保存
2 bug email中，存在 Dear xx, 换行 Hello. 如此等句式，这应该算作一句话进行分析，但实际却分为两句，且第一句由于逗号结尾不会审查
3 逻辑 当我修改句子时，右侧就已进入待分析状态，并清除了修改意见，让用户在还没有解决句子问题时就开始重新评价了，可以适当增加重新评价的等待间隔，并告诉我该间隔具体设置位置，在未开始重新评价时需要保留修改意见; 包括分析全文的结果，会在改动时消失，而正常逻辑应该是不消失，并可以等待用户重新选择开始评价全文
4 疑似bug 我写了这样一句话 "I recently moved into your apartment, and I found it cozy and comfortable. Last day, however, I experienced issues with the heating system." 系统却提示后句中的however的用法需要上下文来支撑，并建议去除，请确定在请求后一句话审议时，模型是否会联系前文(即会通知模型前文内容)?；在请求重新评估时，模型是否会联系前后文?
5 疑似bug 我写了这样一句话 "I cannot bear the freeze water and it truly trouble my experience of showering in the evening." 模型没有优先给出trouble的使用错误，而是优先给出了替换为affects的意见，导致审议变为了可选优化